'use strict';
const assert = require('assert');
const M = require('../assets/js/pos-overview-metrics.js');

const ts = (iso) => ({ toDate: () => new Date(iso), toMillis: () => Date.parse(iso) });
const line = (id, quantity, gross, discount = 0) => ({ item_id:id,item_name:id,quantity,gross_amount:gross,discount_amount:discount });
const order = (patch = {}) => ({ id:'o1',channel:'staff',table_id:'t1',paid_at:ts('2026-09-01T03:00:00Z'),updated_at:ts('2026-09-01T03:01:00Z'),status:'paid',lines:[line('coffee',2,100000,10000)],subtotal:100000,discount_amount:10000,discount_total:20000,total_amount:96000,service_charge_amount:6000,tax_amount:10000,payments:[{method:'cash',amount:40000,status:'settled'},{method:'qris',amount:56000,status:'settled'}],...patch});
const range = { startMs:Date.parse('2026-09-01T00:00:00Z'),endMs:Date.parse('2026-09-30T23:59:59Z') };

const current = M.calculate([order()], range);
assert.equal(current.completedTransactions,1);
assert.equal(current.grossSales,100000);
assert.equal(current.discounts,20000,'line and order discounts count exactly once');
assert.equal(current.netPosSales,80000,'tax and service are excluded');
assert.equal(current.averageOrderValue,80000);
assert.equal(current.modes[0].mode,'dine_in');
assert.equal(current.payments.reduce((s,p)=>s+p.amount,0),80000,'split tender is allocated to merchandise net');

const refunded = order({refunded_at:ts('2026-09-05T01:00:00Z'),refund_transaction_id:'r1'});
const withRefund = M.calculate([refunded], range);
assert.equal(withRefund.completedTransactions,1,'refund does not erase the completed transaction');
assert.equal(withRefund.refunds,80000);
assert.equal(withRefund.netPosSales,0);
assert.equal(withRefund.products[0].units,0,'full refund reverses product units in its event period');
assert.equal(withRefund.modes[0].netSales,0,'mode sales reconcile with refunds without erasing order count');

const outsideSaleRefund = order({paid_at:ts('2026-08-20T01:00:00Z'),refunded_at:ts('2026-09-05T01:00:00Z'),refund_transaction_id:'r2'});
const reversalOnly = M.calculate([outsideSaleRefund], range);
assert.equal(reversalOnly.completedTransactions,0);
assert.equal(reversalOnly.netPosSales,-80000,'refund uses refund date, not original sale date');
assert.equal(reversalOnly.averageOrderValue,null,'zero denominator is unavailable');

const voided = order({id:'void',paid_at:null,status:'void',voided_at:ts('2026-09-03T00:00:00Z')});
assert.equal(M.calculate([voided],range).cancellations,1);
assert.equal(M.calculate([voided],range).completedTransactions,0);

const duplicate = order({updated_at:ts('2026-09-02T00:00:00Z'),total_amount:76000});
const deduped = M.calculate([order(),duplicate],range);
assert.equal(deduped.completedTransactions,1,'stable first-party id deduplicates');
assert.equal(deduped.quality.duplicateRows,1);

const badConnector = order({id:'import-doc',channel:'connector'});
const goodConnector = order({id:'import-doc-2',channel:'connector',connector_source:'vendor',source_order_id:'123'});
const connectors = M.calculate([badConnector,goodConnector],range);
assert.equal(connectors.completedTransactions,1);
assert.equal(connectors.quality.excludedConnectorRows,1,'unidentified imports are unavailable, never guessed');

const jakarta = M.bucket(M.calculate([order({paid_at:ts('2026-08-31T17:30:00Z')})],{
    startMs:Date.parse('2026-08-31T17:00:00Z'),endMs:Date.parse('2026-09-30T16:59:59Z')
}),{hourly:false,timeZone:'Asia/Jakarta'});
assert.equal(jakarta[0].key,'2026-09-01','bucketing uses merchant timezone across UTC midnight');
assert.equal(M.compare({x:10},{x:0},'x').percent,null,'zero prior period has no percentage');

console.log('pos overview calculations: clean');
