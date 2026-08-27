const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, 'data', 'pcbuilder.db');
const USD_TO_INR_RATE = 80; // 1 USD = 80 INR

async function convertPrices() {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(dbPath);
    
    console.log('🔄 Converting all prices from USD to INR...');
    console.log(`💱 Exchange rate: 1 USD = ${USD_TO_INR_RATE} INR`);
    
    // First, get all components to see current prices
    db.all("SELECT id, name, price FROM components ORDER BY id", [], (err, rows) => {
      if (err) {
        reject(err);
        return;
      }
      
      console.log('\n📊 Current prices (USD):');
      rows.forEach(row => {
        console.log(`  ${row.id}: ${row.name} - $${row.price}`);
      });
      
      // Update all prices by multiplying by 80
      db.run(
        "UPDATE components SET price = price * ?", 
        [USD_TO_INR_RATE], 
        function(err) {
          if (err) {
            reject(err);
            return;
          }
          
          console.log(`\n✅ Updated ${this.changes} components with INR pricing`);
          
          // Show updated prices
          db.all("SELECT id, name, price FROM components ORDER BY id", [], (err, rows) => {
            if (err) {
              reject(err);
              return;
            }
            
            console.log('\n💰 New prices (INR):');
            rows.forEach(row => {
              console.log(`  ${row.id}: ${row.name} - ₹${row.price.toLocaleString('en-IN')}`);
            });
            
            db.close((err) => {
              if (err) {
                reject(err);
              } else {
                console.log('\n🎉 Price conversion completed successfully!');
                console.log('💡 All prices are now in Indian Rupees (INR)');
                resolve();
              }
            });
          });
        }
      );
    });
  });
}

// Run the conversion
if (require.main === module) {
  convertPrices()
    .then(() => {
      console.log('\n🚀 You can now start your PC Builder server with realistic INR pricing!');
      process.exit(0);
    })
    .catch(err => {
      console.error('❌ Error converting prices:', err);
      process.exit(1);
    });
}

module.exports = { convertPrices };