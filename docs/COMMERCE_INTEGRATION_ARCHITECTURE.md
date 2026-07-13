# FluxyOS Commerce Integration Architecture
Version: 1.0
Status: Product Architecture
Owner: FluxyOS

> **Note (2026-07-13):** Some decisions in this document are superseded by the
> Phase 0 architecture review — see `docs/COMMERCE_INTEGRATION_PHASE0_REVIEW.md`
> (backend is Netlify Functions, not FastAPI; commerce collections are
> workspace-scoped, not `users/{userId}`; token storage is split out of
> `commerce_accounts`). Where the two conflict, the Phase 0 review wins.

---

# Purpose

This document defines the long-term architecture for the Commerce Integration Platform inside FluxyOS.

Its purpose is to standardize how every ecommerce platform connects to FluxyOS without requiring changes to the Finance Engine, AI layer, Dashboard, Reporting, or Tax modules.

The objective is not simply to integrate marketplaces.

The objective is to transform FluxyOS into the financial operating system for commerce businesses.

---

# Vision

Today

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

Future

Marketplace APIs

↓

FluxyOS Integration Platform

↓

Normalization Layer

↓

Financial Engine

↓

Unified Ledger

↓

Reports

↓

Forecasting

↓

Tax

↓

Fluxy AI

Once a business connects a marketplace, everything should synchronize automatically.

---

# Design Principles

## 1. Marketplace Agnostic

Every marketplace is treated as a connector.

Nothing outside the connector layer should know whether data originated from

• TikTok Shop

• Shopee

• Tokopedia

• Lazada

• Shopify

• WooCommerce

• Amazon

---

## 2. One Canonical Data Model

Every marketplace returns different APIs.

FluxyOS owns the internal schema.

Never expose marketplace-specific fields outside the connector.

---

## 3. Connector Isolation

Each marketplace implementation must remain isolated.

Example

```
TikTok Connector

Shopee Connector

Tokopedia Connector

Lazada Connector
```

Each connector only handles

Authentication

↓

API Requests

↓

Webhook Parsing

↓

Normalization

Everything else remains identical.

---

## 4. Backend First

The frontend never communicates directly with marketplace APIs.

Flow

Frontend

↓

FastAPI

↓

Connector

↓

Marketplace

---

## 5. Security First

OAuth credentials

Refresh Tokens

Access Tokens

Webhook Signatures

must never reach the frontend.

Everything remains backend only.

---

# Overall System Architecture

```
                     +------------------------+
                     |   Commerce Platform    |
                     +-----------+------------+
                                 |
         --------------------------------------------------
         |           |            |            |           |
     TikTok      Shopee      Tokopedia     Shopify     Lazada
         |           |            |            |           |
         --------------------------------------------------
                                 |
                      OAuth / API Layer
                                 |
                         Integration Service
                                 |
                         Webhook Receiver
                                 |
                            Sync Queue
                                 |
                     Normalization Engine
                                 |
                    Finance Mapping Engine
                                 |
                          Firestore Storage
                                 |
      -------------------------------------------------------
      |           |            |            |              |
   Dashboard    Reports      Budget       Tax          Fluxy AI
```

---

# Layer Architecture

## Layer 1

Marketplace Connector

Responsibilities

• OAuth

• API Client

• Token Refresh

• Rate Limit

• Webhook Parsing

Nothing else.

---

## Layer 2

Synchronization Engine

Responsible for

Initial Sync

Manual Sync

Incremental Sync

Realtime Sync

Retry Logic

Scheduling

---

## Layer 3

Normalization Layer

Converts marketplace responses into FluxyOS format.

Example

Shopee

income_amount

TikTok

payment_total

Tokopedia

gross_income

↓

FluxyOS

grossRevenue

---

## Layer 4

Finance Mapping Engine

Transforms commerce events into accounting events.

Marketplace Order

↓

Revenue

Marketplace Commission

↓

Expense

Settlement

↓

Cash Movement

Refund

↓

Revenue Adjustment

---

## Layer 5

Storage Layer

Firestore

Only normalized data.

Never raw API payloads except optional debugging logs.

---

## Layer 6

Business Intelligence

Dashboard

Reports

Budgets

Forecasting

Tax

AI

Everything consumes normalized data.

---

# Supported Platforms

## Commerce

TikTok Shop

Shopee

Tokopedia

Lazada

Blibli

Shopify

WooCommerce

Amazon

Magento

eBay

---

## Payment

Midtrans

Xendit

Stripe

PayPal

Doku

---

## Accounting

Accurate

Jurnal

Xero

QuickBooks

---

## Banking

BCA

Mandiri

BNI

BRI

Permata

---

## Marketing

Google Ads

Meta Ads

TikTok Ads

---

# Firestore Architecture

```
users

    userId

        commerce_accounts

        commerce_orders

        commerce_order_items

        commerce_transactions

        commerce_refunds

        commerce_settlements

        commerce_payouts

        commerce_sync_jobs

        commerce_sync_errors

        commerce_webhook_logs

        audit_logs

        transactions

        bills

        subscriptions
```

Notice

Commerce collections are operational data.

transactions remains the financial ledger.

---

# Commerce Account

Stores

Platform

Store

OAuth

Connection

Health

Sync

Fields

platform

store_id

store_name

region

currency

status

access_token

refresh_token

expires_at

last_sync

sync_status

created_at

updated_at

---

# Order Model

Fields

order_id

platform

store

customer

items

subtotal

discount

voucher

shipping

tax

marketplace_fee

affiliate_fee

payment_fee

gross_sales

net_sales

currency

status

created_at

updated_at

---

# Settlement Model

settlement_id

amount

bank

status

processed_at

---

# Refund Model

refund_id

order_id

amount

reason

status

approved_at

---

# Synchronization

## Initial

Import previous 90 days.

---

## Manual

User clicks

Sync Now

---

## Incremental

Every 10 minutes.

---

## Webhook

Realtime.

---

## Nightly

Reconciliation

Detect missing transactions.

---

# Queue Pipeline

```
Pending

↓

Running

↓

Success

↓

Archive
```

If Failed

↓

Retry

↓

Retry

↓

Retry

↓

Notify User

---

# Duplicate Detection

Primary Key

Platform

Store

Order

Transaction

Settlement

If exists

Update

Never Insert

---

# Finance Mapping

Order Completed

↓

Revenue

Commission

↓

Expense

Refund

↓

Negative Revenue

Settlement

↓

Cash

Shipping Subsidy

↓

Revenue Adjustment

Everything becomes ledger transactions.

---

# Multi Store

Support unlimited stores.

Example

Shopee

Store A

Store B

Store C

TikTok

Store D

Tokopedia

Store E

Dashboard aggregates automatically.

---

# Dashboard Capabilities

Revenue

Orders

Refunds

Fees

Profit

Settlement

Marketplace Comparison

Store Comparison

Top Products

Revenue Trend

---

# AI Capabilities

Fluxy AI understands

Revenue

Orders

Refunds

Settlement

Marketplace Fees

Product Profitability

Store Performance

Forecast

Questions

Compare Shopee vs TikTok.

Which marketplace is most profitable?

Why is margin decreasing?

Which products receive most refunds?

Forecast next month's revenue.

---

# Security

OAuth encrypted.

Backend only.

Webhook verification.

Automatic token refresh.

Audit logs.

Rate limiting.

Retry strategy.

Per-user isolation.

---

# Future Expansion

Adding a marketplace should only require

1.

Connector

2.

Webhook Adapter

3.

Normalizer

No changes to

Dashboard

Ledger

Reports

AI

Tax

Budget

Finance Engine

---

# Engineering Rules

Never consume marketplace payloads directly.

Always normalize first.

Never bypass Finance Mapping.

Never let AI consume raw marketplace APIs.

Never write directly to ledger from marketplace connectors.

Never duplicate business logic across connectors.

All financial calculations happen after normalization.

---

# Success Criteria

A business owner should be able to connect every sales channel once.

After that

Revenue

Orders

Refunds

Settlements

Fees

Taxes

Payouts

Reports

Cashflow

Budgets

Forecasting

and Fluxy AI

should continuously update automatically without manual CSV imports.

This architecture should remain scalable for years while supporting dozens of commerce providers with minimal engineering effort.