#!/usr/bin/env node

const assert = require('node:assert/strict');
const { __test__ } = require('../netlify/functions/api.js');

if (!__test__?.classifyAmbiguousExtraction) {
    throw new Error('AI upload routing helpers are not exported for regression QA.');
}

const { classifyAmbiguousExtraction } = __test__;

const cases = [
    {
        name: 'Starbucks-style receipt routes to Ledger, not Bills',
        input: {
            document_type: 'receipt',
            vendor_name: 'Starbucks',
            amount: 58000,
            invoice_number: null,
            due_date: null,
            raw_text_preview: 'Starbucks Coffee Total Rp 58.000',
        },
        expected: 'receipt',
    },
    {
        name: 'Vendor and amount alone route to receipt review',
        input: {
            document_type: 'unknown',
            vendor_name: 'Cafe Vendor',
            amount: 125000,
            invoice_number: null,
            due_date: null,
            raw_text_preview: 'Cafe Vendor Total Rp 125.000',
        },
        expected: 'receipt',
    },
    {
        name: 'POS tax invoice wording still routes to Ledger when it is a paid receipt',
        input: {
            document_type: 'invoice',
            vendor_name: 'Starbucks',
            amount: 58000,
            invoice_number: 'BILL-7788',
            due_date: null,
            raw_text_preview: 'Starbucks Coffee Tax Invoice Bill No 7788 Cashier 02 Total Paid Rp 58.000',
        },
        expected: 'receipt',
    },
    {
        name: 'Order number without due date is still a receipt signal',
        input: {
            document_type: 'invoice',
            vendor_name: 'Chagee',
            amount: 49000,
            invoice_number: '20260518092041000073418068',
            due_date: null,
            raw_text_preview: 'TIE GUAN YIN MILK TEA Rp 49.000 1 Items Subtotal Rp 49.000 QRIS Rp 49.000 Order Time 18/05/2026 16:10:08 Order Number 20260518092041000073418068',
        },
        expected: 'receipt',
    },
    {
        name: 'Invoice number alone without due date stays unknown',
        input: {
            document_type: 'invoice',
            vendor_name: 'Cloud Vendor',
            amount: 750000,
            invoice_number: 'INV-1001',
            due_date: null,
            raw_text_preview: 'Invoice INV-1001 total Rp 750.000',
        },
        expected: 'unknown',
    },
    {
        name: 'Due date is bill-specific evidence',
        input: {
            document_type: 'bill',
            vendor_name: 'Utility Vendor',
            amount: 420000,
            invoice_number: null,
            due_date: '2026-06-15',
            raw_text_preview: 'Amount due Rp 420.000 Pay before 15 Jun 2026',
        },
        expected: 'bill',
    },
    {
        name: 'No readable finance evidence stays unknown',
        input: {
            document_type: 'unknown',
            vendor_name: null,
            amount: null,
            invoice_number: null,
            due_date: null,
            raw_text_preview: null,
        },
        expected: 'unknown',
    },
];

for (const testCase of cases) {
    assert.equal(
        classifyAmbiguousExtraction(testCase.input),
        testCase.expected,
        testCase.name
    );
}

console.log(`AI upload routing regression passed (${cases.length} cases).`);
