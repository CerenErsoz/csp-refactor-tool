
const fs = require('fs').promises;
const path = require('path');
const cheerio = require('cheerio');

// Kök dizinden okunacak event handler kodlarını biriktirir.
const allEventHandlers = [];
let uniqueIdCounter = 0;

const EVENT_ATTRIBUTES = ['onclick', 'onchange'];

/**
 * Belirtilen bir dizini yinelemeli olarak tarar ve .cshtml uzantılı tüm dosyaların yollarını döndürür.
 * @param {string} dir - Taranacak dizin.
 * @returns {Promise<string[]>} .cshtml dosyalarının yollarını içeren bir dizi.
 */
async function findCshtmlFiles(dir) {
    let results = [];
    const list = await fs.readdir(dir);
    for (const file of list) {
        const filePath = path.resolve(dir, file);
        const stat = await fs.stat(filePath);
        if (stat && stat.isDirectory()) {
            results = results.concat(await findCshtmlFiles(filePath));
        } else if (path.extname(filePath) === '.cshtml') {
            results.push(filePath);
        }
    }
    return results;
}

/**
 * Bir .cshtml dosyasını işler, inline event'leri kaldırır ve harici bir JS dosyası için hazırlar.
 * @param {string} filePath - İşlenecek dosyanın yolu.
 */
async function processFile(filePath) {
    console.log(`Processing: ${filePath}`);
    const originalContent = await fs.readFile(filePath, 'utf8');
    const $ = cheerio.load(originalContent, {
        decodeEntities: false, // HTML entity'lerini olduğu gibi bırak
        withStartIndices: true, // Konum tespiti için
    });

    let fileModified = false;

    const selector = EVENT_ATTRIBUTES.map(attr => `[${attr}]`).join(',');
    const elements = $(selector);

    elements.each((index, elementNode) => {
        fileModified = true;
        const element = $(elementNode);
        let id = element.attr('id');

        // Eğer ID yoksa, benzersiz bir ID oluştur ve ata
        if (!id) {
            id = `csp-auto-id-${uniqueIdCounter++}`;
            element.attr('id', id);
        }

        EVENT_ATTRIBUTES.forEach(attr => {
            const scriptContent = element.attr(attr);
            if (scriptContent) {
                const eventType = attr.substring(2); // 'onclick' -> 'click'

                // Event handler fonksiyonunu oluştur
                const handlerCode = `
// Handler for element #${id}
const el_${id}_${eventType} = document.getElementById('${id}');
if (el_${id}_${eventType}) {
  el_${id}_${eventType}.addEventListener('${eventType}', function(event) {
    try {
      ${scriptContent}
    } catch(e) {
      console.error("Error executing legacy script for #${id} on ${eventType}", e);
    }
  });
}`;
                allEventHandlers.push(handlerCode);
                
                // Inline attribute'ü kaldır
                element.removeAttr(attr);
            }
        });
    });

    // Eğer dosyada değişiklik yapıldıysa, dosyayı güncelle
    if (fileModified) {
        const updatedContent = $.html();
        await fs.writeFile(filePath, updatedContent, 'utf8');
        console.log(`  Updated: ${filePath}`);
    } else {
        console.log(`  No changes needed for: ${filePath}`);
    }
}

/**
 * Ana betik fonksiyonu
 */
async function main() {
    const rootDir = process.argv[2];
    if (!rootDir) {
        console.error('Lütfen taranacak bir kök dizin belirtin.');
        console.error('Kullanım: node refactor_csp.js <dizin_yolu>');
        process.exit(1);
    }

    console.log(`Scanning for .cshtml files in ${rootDir}...`);
    const files = await findCshtmlFiles(rootDir);
    console.log(`Found ${files.length} .cshtml files.`);

    for (const file of files) {
        await processFile(file);
    }

    if (allEventHandlers.length > 0) {
        const eventScriptHeader = `/*
 * Bu dosya, refactor_csp.js betiği tarafından otomatik olarak oluşturulmuştur.
 * .cshtml dosyalarındaki inline JavaScript event handler'larını içerir.
 */
document.addEventListener('DOMContentLoaded', function() {`;

        const eventScriptFooter = `
});
`;
        const finalScriptContent = eventScriptHeader + allEventHandlers.join('') + eventScriptFooter;
        const outputPath = path.join(rootDir, 'site-events.js');
        
        await fs.writeFile(outputPath, finalScriptContent, 'utf8');
        console.log(`
✅ Event handlers have been written to: ${outputPath}`);
        console.log('Lütfen bu dosyayı ana layout (_Layout.cshtml vb.) dosyanıza eklemeyi unutmayın:');
        console.log(`<script src="~/site-events.js" defer></script>`);

    } else {
        console.log('No inline event handlers found to refactor.');
    }
    
    console.log('Refactoring complete!');
}

main().catch(error => {
    console.error('An unexpected error occurred:', error);
});
