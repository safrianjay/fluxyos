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

---

## 🚫 Anti-AI-Slop Visual Standards (Hard Rules)

These rules are mandatory for every new page, feature, and reusable component.
The goal is to prevent generic, template-like output and enforce intentional
visual hierarchy, semantic color logic, and task-first UX clarity.

### Enforcement Contract
- `design_system.md` is the source of truth for anti-slop rules.
- `QA_CHECKLIST.md` is the enforcement gate.
- Any anti-slop QA failure is a blocking failure for final gate/push.

### 1) Layout & Hierarchy (Hard Rules)
- First viewport must communicate this order within 3 seconds:
  - `what this screen is`
  - `what to do next`
  - `what matters most right now`
- Exactly one primary action per viewport zone. Secondary and tertiary actions
  must be visibly lower emphasis.
- Avoid equal-weight CTA clusters: do not render two or more adjacent actions
  with identical weight, fill, size, and contrast unless the user explicitly
  requests parity.
- Section rhythm must follow a deliberate spacing scale. Use repeated spacing
  tokens; avoid ad hoc one-off values that create visual jitter.
- Do not use card-per-everything composition. Use cards only when they provide
  meaningful grouping, state, or interaction boundaries.
- Information hierarchy must remain stable at both `375px` and `1280px`.
  Primary message/action must not be displaced below decorative elements.

### 2) Color System (Hard Rules)
- Every page must map colors to semantic roles:
  - `primary action`
  - `secondary action`
  - `success`
  - `warning`
  - `error`
  - `disabled`
  - `neutral structure` (bg/surfaces/borders/text)
- Semantic meaning must remain consistent across components on the same page.
  Do not reuse one hue for conflicting meanings.
- Accent colors are for emphasis, not base structure. Avoid accent overuse in
  large backgrounds, repeated chips, or multiple simultaneous focal points.
- Contrast must meet practical readability standards:
  - body text and key labels must be comfortably readable at normal zoom
  - interactive elements must remain legible in hover/focus/disabled states
- Avoid single-hue dominance across full page where all surfaces, accents, and
  states collapse into one color family.

### 3) Typography (Hard Rules)
- Typography must define hierarchy, not decoration:
  - clear delta between headline, section title, body, and metadata text
  - no near-identical sizes/weights for different information levels
- Heading line length and body measure must stay readable:
  - avoid overly long headlines that behave like paragraphs
  - avoid dense body text blocks with no visual pause points
- Decorative typography is allowed only when it does not reduce readability,
  semantic structure, or action clarity.
- Financial and tabular values should stay visually scannable and aligned with
  existing dashboard conventions.

### 4) Component Discipline (Hard Rules)
- Buttons must follow role mapping:
  - one dominant primary style
  - secondary style visibly lower emphasis
  - destructive style clearly differentiated
- Tables/lists must prioritize scanability:
  - clear header contrast
  - stable alignment
  - row separation and hover states that aid reading
- Icon use must be consistent in stroke/fill style and size rhythm.
  Avoid mixed icon systems in one surface unless explicitly required.
- Card boundaries, radii, and shadows must follow system values; avoid stacking
  multiple effect styles that create noise.

### 5) Motion & Effects (Hard Rules)
- Motion must explain state or guide attention; decorative-only motion is
  prohibited when it does not support comprehension or action.
- Limit concurrent animated elements per viewport zone. Use a small number of
  meaningful animations instead of many competing effects.
- Effects (blur, glow, glass, gradients) must never reduce text legibility or
  obscure hierarchy.
- Parallax, shimmer, and pulse effects are opt-in accents; they are not default
  page styling.

### 6) Content Density & Composition (Hard Rules)
- Every section must earn its space with real utility:
  - data, decision context, workflow action, or concrete explanation
- Prohibit filler sections that only restate obvious claims or duplicate nearby
  content with alternate phrasing.
- Avoid template stacking (hero + three cards + testimonial + CTA) unless each
  section serves a distinct product purpose.
- Visual density should match task context:
  - operational screens: higher information density with clean grouping
  - marketing screens: lower density but stronger hierarchy and clear CTA

### Prohibited Patterns (Hard Bans)
- Generic purple-neon SaaS gradient look as default style unless explicitly
  requested by user/product direction.
- Excessive glassmorphism/glow layering that reduces legibility or diffuses
  action hierarchy.
- Hero or section composition where decorative media overpowers primary message
  and primary action.
- Color-only differentiation where status/action meaning is ambiguous without
  text or structure.
- Repetitive cloned card grids with identical visual weight and no clear
  prioritization.

### Exception Protocol
- Exceptions are allowed only when:
  - explicitly requested by the user, or
  - required by documented product constraints.
- Every exception must be logged in QA results with:
  - which anti-slop rule was waived
  - rationale
  - impacted screens/components
  - risk tradeoff accepted
