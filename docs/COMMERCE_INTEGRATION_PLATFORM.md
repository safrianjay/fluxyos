# FluxyOS Commerce Integration Platform
## Implementation Master Prompt for Claude Code

> **Note (2026-07-13):** Some decisions in this document are superseded by the
> Phase 0 architecture review — see `docs/COMMERCE_INTEGRATION_PHASE0_REVIEW.md`
> (backend is Netlify Functions, not FastAPI; commerce collections are
> workspace-scoped, not `users/{userId}`; token storage is split out of
> `commerce_accounts`). Where the two conflict, the Phase 0 review wins.

---

# Goal

Design and implement a production-ready Commerce Integration Platform for FluxyOS that allows businesses to securely connect their ecommerce stores (TikTok Shop, Shopee, Tokopedia, etc.) and automatically synchronize revenue, orders, payouts, marketplace fees, refunds, settlements, and related financial data into FluxyOS.

This is **NOT** simply an "Integration" page.

This is the foundation of FluxyOS becoming the Financial Operating System for commerce businesses.

The implementation must be scalable enough to support dozens of commerce platforms without requiring architecture changes.

---

# Before Implementation (MANDATORY)

Read these project documents first:

- PROJECT_BACKGROUND.md
- SYSTEM_DESIGN.md
- SECURITY_SYSTEM.md
- ROADMAP.md
- QA_CHECKLIST.md
- DESIGN_SYSTEM.md
- product_ux_feature_intake_framework.md

Do not start implementation until these documents are understood.

---

# Existing Tech Stack

Do NOT change the existing architecture.

Frontend

- Static HTML
- Tailwind CSS
- Vanilla JavaScript

Backend

- FastAPI
- Firebase Authentication
- Firestore

Never introduce

- React
- Vue
- Angular
- NextJS
- npm packages requiring frontend build process

Maintain current project architecture.

---

# Product Vision

Current

Marketplace

↓

CSV Export

↓

Excel

↓

Accounting

↓

Dashboard

↓

AI

Target

Marketplace APIs

↓

FluxyOS Integration Layer

↓

Normalization Engine

↓

Finance Mapping Engine

↓

Ledger

↓

Reports

↓

Tax

↓

AI

Everything should happen automatically after the initial connection.

---

# Business Objective

Allow businesses to connect multiple commerce channels.

Examples

- TikTok Shop
- Shopee
- Tokopedia
- Lazada
- Shopify
- WooCommerce

Once connected

FluxyOS automatically keeps financial data synchronized.

No manual CSV upload.

No manual reconciliation.

No manual revenue tracking.

---

# Feature Classification

Platform Feature

Workflow Feature

Integration Feature

Intelligence Feature

---

# Supported Platforms

## Phase 1

TikTok Shop

Shopee

Tokopedia

---

## Phase 2

Lazada

Blibli

Shopify

WooCommerce

---

## Phase 3

Amazon

eBay

Facebook Shop

Instagram Shop

Magento

---

# High Level Architecture

Marketplace

↓

OAuth

↓

Integration Service

↓

Webhook

↓

Sync Queue

↓

Normalization Engine

↓

Finance Mapping Engine

↓

Firestore

↓

Dashboard

↓

Fluxy AI

---

# Core Principle

Marketplace APIs should NEVER directly create financial reports.

Everything must first pass through

Normalization Layer

↓

Finance Mapping Layer

↓

Ledger

↓

Reports

↓

AI

The entire application should consume normalized data.

Never consume raw marketplace responses outside the connector layer.

---

# New Dashboard Page

Create a dedicated page

Integration Center

Categories

Commerce

Payment

Accounting

Bank

Marketing

Communication

Commerce

- TikTok Shop
- Shopee
- Tokopedia
- Lazada
- Shopify
- WooCommerce

Payment

- Midtrans
- Xendit
- Stripe
- PayPal

Accounting

- Jurnal
- Accurate
- Xero
- QuickBooks

Bank

- BCA
- Mandiri
- BRI
- BNI

Marketing

- Google Ads
- Meta Ads
- TikTok Ads

Communication

- WhatsApp
- Gmail

Each integration card must display

- logo
- description
- connection status
- last sync
- sync health
- connect button

---

# OAuth Flow

User clicks Connect

↓

Marketplace Login

↓

Grant Permission

↓

Receive Authorization Code

↓

Exchange Token

↓

Encrypt Token

↓

Save Securely

↓

Trigger Initial Sync

Never expose OAuth tokens to frontend JavaScript.

Everything must happen through backend APIs.

---

# Token Management

Support

Access Token

Refresh Token

Expiration

Auto Refresh

Disconnect

Reconnect

Expired Token Recovery

Encrypt all credentials before storing.

---

# Firestore Collections

Maintain existing user-scoped architecture.

Create new collections

users/{userId}/commerce_accounts

users/{userId}/commerce_orders

users/{userId}/commerce_order_items

users/{userId}/commerce_transactions

users/{userId}/commerce_refunds

users/{userId}/commerce_payouts

users/{userId}/commerce_settlements

users/{userId}/commerce_sync_jobs

users/{userId}/commerce_sync_errors

users/{userId}/commerce_webhook_logs

Do NOT create global collections.

Everything remains scoped to authenticated users.

---

# Commerce Account Schema

Example

commerce_accounts

- platform
- shop_id
- shop_name
- region
- currency
- status
- access_token
- refresh_token
- expires_at
- last_sync
- sync_health
- created_at
- updated_at

Tokens must be encrypted.

---

# Orders Schema

Each order should include

order_id

order_number

platform

shop_id

customer

items

sku

quantity

subtotal

discount

shipping_fee

voucher

tax

marketplace_fee

affiliate_fee

payment_fee

refund_amount

gross_sales

net_sales

currency

status

created_at

updated_at

---

# Settlement Schema

settlement_id

platform

shop

amount

currency

bank

status

processed_at

created_at

---

# Refund Schema

refund_id

order_id

reason

status

amount

approved_at

---

# Synchronization Engine

Support

Initial Sync

Manual Sync

Incremental Sync

Realtime Webhook

Nightly Reconciliation

Initial Sync

Import previous 90 days.

Manual Sync

Sync Now button.

Incremental

Every 10 minutes.

Webhook

Realtime updates.

Nightly

Verify missing transactions.

---

# Webhook Events

Support

New Order

Order Paid

Order Completed

Refund Created

Refund Completed

Order Cancelled

Settlement Paid

Store Updated

Product Updated

Webhook events should trigger immediate synchronization.

---

# Queue System

Implement background queue.

Every sync job

Pending

↓

Running

↓

Completed

↓

Failed

Failed jobs

Retry automatically.

Use exponential backoff.

---

# Normalization Layer

Every marketplace has different response fields.

Convert all marketplace responses into one unified FluxyOS schema.

Example

Shopee

income_amount

TikTok

payment_total

Tokopedia

gross_income

FluxyOS

grossRevenue

Everything after normalization should be platform-independent.

---

# Universal Commerce Transaction Model

Fields

platform

shop

order_id

transaction_id

grossRevenue

discount

shippingIncome

commissionFee

platformFee

paymentFee

affiliateFee

refundAmount

tax

netRevenue

settlementAmount

settlementDate

currency

status

createdAt

updatedAt

Do NOT use marketplace-specific fields after normalization.

---

# Finance Mapping Engine

Convert commerce events into finance records.

Example

Marketplace Order

↓

Revenue Transaction

Marketplace Commission

↓

Expense Transaction

Marketplace Shipping Subsidy

↓

Revenue Adjustment

Refund

↓

Revenue Reversal

Settlement

↓

Cash Movement

Everything becomes standard FluxyOS ledger entries.

---

# Duplicate Detection

Prevent duplicate imports.

Unique Key

platform

shop_id

order_id

transaction_id

settlement_id

If record exists

Update

Never create duplicate ledger entries.

---

# Multi Store Support

One user should connect many stores.

Example

Shopee

Store A

Store B

TikTok

Store C

Tokopedia

Store D

Dashboard should aggregate all stores while still allowing filtering by

Platform

Store

Marketplace

Date

Status

---

# Dashboard Enhancements

Revenue card

Revenue by marketplace

Revenue trend

Orders

Refunds

Marketplace fees

Settlement waiting

Payout status

Top marketplace

Top store

Platform comparison

Store comparison

---

# AI Integration

Fluxy AI must understand commerce data.

Example questions

Which marketplace generated the highest revenue?

Which marketplace has the highest fees?

Compare Shopee vs TikTok.

Show today's settlements.

Why did profit decrease?

Which products have the highest refunds?

Which store performs best?

Forecast next month's revenue.

Show unpaid settlements.

Everything must be answered from normalized data.

Never query marketplace APIs directly from AI.

---

# Backend Services

Implement separate services

OAuth Service

Marketplace Connector

Webhook Service

Sync Scheduler

Sync Queue

Normalization Service

Finance Mapping Engine

Duplicate Detection

Settlement Service

Audit Service

Notification Service

AI Data Service

Keep responsibilities isolated.

---

# Security

Encrypt OAuth credentials.

Backend-only API communication.

Verify webhook signatures.

Validate every payload.

Rate limit API requests.

Automatic token refresh.

Per-user data isolation.

Disconnect revokes tokens.

All actions create audit logs.

---

# UI Requirements

Connection cards

Connection wizard

Sync status

Sync history

Error logs

Manual sync

Disconnect confirmation

Reconnect flow

Platform filters

Store filters

Loading states

Skeleton loaders

Empty states

Retry states

Success states

Everything must follow the existing FluxyOS design system.

---

# Future Ready

The architecture must allow adding a new marketplace by implementing only

Connector

↓

Normalizer

↓

Webhook Adapter

Without changing

Dashboard

Reports

Ledger

AI

Tax

Finance Engine

---

# Acceptance Criteria

A business owner should be able to

✅ Connect TikTok Shop

✅ Connect Shopee

✅ Connect Tokopedia

✅ Sync orders

✅ Sync revenue

✅ Sync refunds

✅ Sync payouts

✅ Sync settlements

✅ View revenue automatically

✅ Ask AI about commerce performance

without uploading CSV files.

---

# Out of Scope

Inventory management

Order fulfillment

Shipping label creation

Marketplace chat

Customer CRM

Warehouse management

Product editing

Advertising campaign management

Focus only on financial synchronization and commerce intelligence.

---

# QA Checklist

Before implementation is considered complete

Verify

- OAuth works
- Tokens refresh correctly
- Manual sync works
- Automatic sync works
- Webhooks work
- Duplicate detection works
- Ledger entries are correct
- Revenue calculations are accurate
- Refund mapping is accurate
- Settlement mapping is accurate
- Dashboard reflects synchronized data
- AI answers use normalized finance data
- Multi-store aggregation works
- Store filtering works
- Audit logs are created
- Security validation passes
- Firestore remains user-scoped
- Existing dashboard features continue working without regression

---

# Final Deliverables

Provide

1. Updated architecture diagram

2. Firestore schema

3. Backend service architecture

4. API endpoint specification

5. OAuth flow diagram

6. Webhook flow diagram

7. Synchronization workflow

8. Normalization mapping

9. Finance mapping specification

10. Database schema

11. UI wireframe recommendations

12. Security considerations

13. Testing strategy

14. Manual QA checklist

15. Future extension strategy

Do not sacrifice scalability for short-term implementation speed. Build this as a long-term platform capability that can support many commerce providers while keeping the rest of FluxyOS independent of provider-specific APIs.