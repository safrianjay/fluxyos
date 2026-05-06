# FluxyOS Design System

This document defines the visual and functional standards for FluxyOS. Follow these guidelines to ensure consistency when building new features or pages.

## 🎨 Color Palette

### Primary Colors
- **Fluxy Orange**: `#EA580C` (Tailwind `orange-600`) - Used for primary actions, logos, and active states.
- **Deep Navy**: `#0B0F19` - Used for sidebars and primary backgrounds.
- **Action Red**: `#EF4444` (Tailwind `red-500`) - Used for destructive actions and critical alerts.

### Supporting Colors
- **Success Green**: `#16A34A` - For positive trends and "Cleared" statuses.
- **Info Blue**: `#3B82F6` - For secondary highlights and progress bars.
- **Neutral Grays**:
    - `gray-50`: Backgrounds
    - `gray-200`: Borders
    - `gray-500`: Secondary text
    - `gray-900`: Headings and primary text

---

## 🔡 Typography

- **Primary Font**: `Inter` (Sans-serif) - Used for all UI elements.
- **Monospace Font**: `Fira Code` - Used for financial amounts and transaction IDs.

### Font Sizes
- **H1**: `3xl` (30px), Bold, `gray-900`.
- **KPI Amounts**: `3xl` (30px), Bold, `font-mono`.
- **Body Text**: `13px` or `14px`, `gray-600`.
- **Small Labels**: `11px` or `12px`, `gray-500`.

---

## 🍱 Components

### 1. Cards
- **Background**: `bg-white`
- **Border**: `border border-gray-200`
- **Radius**: `rounded-xl` (12px)
- **Shadow**: `shadow-sm`

### 2. Buttons
- **Primary**: `bg-gray-900 text-white`, `rounded-lg`, `hover:bg-gray-800`.
- **Secondary**: `bg-white text-gray-700`, `border border-gray-200`, `hover:bg-gray-50`.
- **Accent**: `text-[#EA580C] font-bold`.

### 3. Tables
- **Header**: `bg-gray-50`, `text-[11px]`, `uppercase`, `tracking-wider`.
- **Row Hover**: `hover:bg-gray-50/50`.
- **Border**: `border-b border-gray-50`.

---

## 📐 Layout & Spacing
- **Sidebar Width**: `260px` (Collapsed: `80px`).
- **Main Padding**: `p-6` or `p-8` for desktop.
- **Content Max-Width**: `1400px`.
- **Gap Standards**: 
    - Between sections: `space-y-6`.
    - Between elements: `gap-3` or `gap-4`.

---

## ✨ Animations & Micro-interactions
- **Transitions**: Use `transition-all duration-200 ease-in-out` for hovers.
- **Sidebar Collapse**: Use CSS `transition: width 0.3s ease`.
- **Shadows**: Elevate cards on hover using `hover:shadow-md`.

---

## 🛠 Usage Checklist
1. [ ] Does it use `Inter` for text and `Fira Code` for money?
2. [ ] Is the primary action color `#EA580C`?
3. [ ] Are corners rounded with `rounded-xl` or `rounded-lg`?
4. [ ] Does the page use the centralized `sidebar-loader.js`?
