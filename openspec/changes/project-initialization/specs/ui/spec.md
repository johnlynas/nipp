# Delta for UI/UX (Property NI Design System)

## ADDED Requirements

### Requirement: Property NI Design Tokens Configuration
The UI configuration MUST strictly adhere to the Property NI Navy & Amber design tokens, mapped to CSS Custom Properties in `app/globals.css` and extended in `tailwind.config.ts`.

#### Scenario: Color Palette Enforcement
- GIVEN the frontend configuration is initialized
- WHEN CSS variables and Tailwind theme colors are defined
- THEN the following semantic color mapping MUST be applied:
  - `color.brand.primary` (Navy): `#1e3a5f` (Primary brand, headings, active states, text on light bg)
  - `color.brand.primary-dark` (Navy Dark): `#152940` (Hover states for primary text, deep shadows)
  - `color.brand.accent` (Amber): `#f4a261` (Primary CTAs, highlights, active nav items, icons)
  - `color.brand.accent-hover` (Deep Amber): `#e76f51` (Hover state for accent buttons/links)
  - `color.surface.default` (White): `#ffffff` (Main background, card/input backgrounds)
  - `color.surface.subtle` (Light Gray): `#f8f9fa` (Secondary backgrounds, disabled states)
  - `color.text.primary` (Navy): `#1e3a5f` (Primary body text, headings)
  - `color.text.secondary` (Gray): `#6c757d` (Secondary text, labels, muted info)
  - `color.text.placeholder` (Light Gray): `#adb5bd` (Input placeholder text)
  - `color.border.default` (Border Gray): `#dee2e6` (Default borders, dividers)
  - `color.state.error` (Red): `#dc3545` (Validation errors, destructive actions)
  - `color.state.success` (Green): `#28a745` (Success states, positive metrics)

#### Scenario: Typography Configuration
- GIVEN the global font family is configured
- WHEN the configuration files are updated
- THEN the font family MUST be set to `'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif`.
- THEN the following type scale MUST be defined:
  - `typo.display.h1`: 28px (1.75rem), Weight 700, Line Height 1.2, Letter Spacing -0.025em
  - `typo.display.logo`: 32px (2rem), Weight 700, Line Height 1.2, Letter Spacing -0.02em
  - `typo.body.lg`: 24px (1.5rem), Weight 400, Line Height 1.4
  - `typo.body.md`: 15px (0.9375rem), Weight 400, Line Height 1.5 (Standard body, inputs)
  - `typo.body.sm`: 14px (0.875rem), Weight 400, Line Height 1.43 (Secondary text, links)
  - `typo.button.md`: 15px (0.9375rem), Weight 600, Line Height 1.25, Letter Spacing -0.025em
  - `typo.button.sm`: 14px (0.875rem), Weight 500, Line Height 1.25

#### Scenario: Spacing, Radii, and Shadows
- GIVEN the design system is applied
- WHEN Tailwind utilities and CSS variables are extended
- THEN spacing MUST utilize an 8px grid scale: `xs` (8px), `sm` (16px), `md` (24px), `lg` (32px), `xl` (64px).
- THEN touch targets MUST be configured to a minimum height of `48px-52px`.
- THEN border radii MUST be defined as: `pill` (26px for buttons/inputs), `sm` (8px for icons/badges), `md` (12px for cards/modals).
- THEN the following specific shadows MUST be defined:
  - `shadow.button`: `0 4px 12px rgba(244,162,97,0.3)`
  - `shadow.button-hover`: `0 6px 16px rgba(244,162,97,0.4)`
  - `shadow.focus-ring`: `0 0 0 3px rgba(30,58,95,0.1)`

### Requirement: Split-Screen Login Layout Scaffolding
The authentication pages directory structure MUST be scaffolded to support the specified 50/50 split-screen layout.

#### Scenario: Directory Structure for Layout
- GIVEN the frontend is scaffolded
- WHEN the authentication directories are created
- THEN empty directories and placeholder layout files MUST be created to house the split layout.
- THEN the layout configuration MUST document the following structural rules for future implementation:
  - **Desktop (>1024px):** 50/50 split. Left panel (Visual: Navy gradient `rgba(30,58,95,0.9)` over image, 64px padding). Right panel (Functional: White bg, 80px/64px padding, max-width 400px centered form).
  - **Tablet (768px-1024px):** Split maintained. Left padding 48px, Right padding 64px/48px.
  - **Mobile (<768px):** Stacked vertically. Left panel collapses to `min-height: 40vh`. Right panel padding 40px/24px. Form heading centers.

### Requirement: Component Scaffolding (Inputs and Buttons)
The directory structure for interactive components MUST be scaffolded to support the Property NI component specifications.

#### Scenario: Directory Structure for Components
- GIVEN the frontend is scaffolded
- WHEN the component directories (`components/ui/`) are created
- THEN empty directories and placeholder files MUST be created to house the specific component configurations:
  - **Inputs:** Height `52px`, Padding `14px 20px`, Radius `26px` (Pill), Border `1px solid var(--border)`. Focus state applies `var(--navy)` border and `var(--shadow.focus-ring)`.
  - **Primary Buttons:** Height `52px`, Width `100%`, Radius `26px`, Bg `var(--amber)`, Text `var(--white)`, Shadow `var(--shadow.button)`. Hover shifts Bg to `var(--amber-hover)`, translates Y `-2px`.
  - **Social Buttons:** Height `52px`, Radius `26px`, Border `2px solid var(--border)`, Bg `var(--white)`. Hover shifts border to `var(--navy)`, Bg to `var(--surface.subtle)`.
  - **Dividers:** Flexbox layout with `1px solid var(--border)` lines and `14px` secondary text ("or continue with").

### Requirement: Accessibility (a11y) Configuration Rules
The UI configuration MUST enforce strict accessibility and motion guidelines via Tailwind/CSS rules.

#### Scenario: WCAG Contrast and Focus States Configuration
- GIVEN the design system is configured
- WHEN focus and color utilities are defined
- THEN custom focus rings (`shadow.focus-ring`) and outline utilities MUST be defined for keyboard navigation.
- THEN a strict CSS rule, linter rule, or documentation comment MUST be established ensuring **Amber (`#f4a261`) is NEVER used for text on a white background** (it fails WCAG AA at ~2.5:1). Amber is strictly for backgrounds, borders, and icons. Text on Amber backgrounds MUST be White.

#### Scenario: Motion and Transitions Configuration
- GIVEN the design system is configured
- WHEN transition utilities are defined in Tailwind/CSS
- THEN state changes (hover, focus, loading) for colors, shadows, and transforms MUST be configured to occur over `0.2s` using an `ease` timing function.
- THEN text link transitions MUST occur over `0.15s`.
- THEN loading spinners MUST be configured for `0.8s linear infinite` rotation.