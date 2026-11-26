---
name: react-bits-pro
description: >
  Install and integrate React Bits Pro components, marketing blocks, App UI
  blocks, Agent Kit skills and landing-page templates into React/Next.js apps
  via the shadcn registry CLI with license-key auth. Use whenever the user wants
  animated components (WebGL/shader backgrounds, GSAP and Motion animation, 3D,
  cursor trails, text effects, cards, carousels, galleries), marketing sections
  (hero, features, pricing, navigation, footer, FAQ, CTA, auth, stats, blog,
  contact, social proof, about, waitlist, showcase, how-it-works, download,
  ecommerce, bento grids and Bento Builder), app interface blocks (app shells, sidebars, dashboards, data
  tables, analytics, command menus, settings, dialogs, kanban, billing,
  onboarding) or AI/agent surfaces (chat, prompt inputs, tool calls, agent
  plans, approvals, usage), landing-page templates, or Agent Kit design skills,
  page prompts and recipes. Also use when integrating these into an existing
  page or design system, or on "react bits", "reactbits",
  "@reactbits-starter", "@reactbits-pro", "app ui" or "agent kit".
license: Proprietary
compatibility: >
  React 18 or 19. Next.js 14+ (App Router recommended) or any React framework
  that supports client components. Tailwind CSS v4 strongly recommended for
  blocks (they use v4 utility names). Node.js 18+ for the shadcn CLI.
metadata:
  author: reactbits
  version: "3.2"
---

# React Bits Pro Integration

You are integrating **React Bits Pro**, a premium shadcn-compatible registry of:

- **230 animated components** (Starter tier and above)
- **300 marketing blocks** in 22 categories (**Pro tier and above**), including 42 composable Bento tiles
- **300 App UI blocks** in 38 categories (**Pro tier and above**)
- **20 Agent Kit items**: design skills, page prompts, recipes and the setup skill (**Pro tier and above**, one free; setup skill available on Starter)
- **15 landing-page templates** (**Ultimate tier**, one free)

Items install as real source files into the user's project; the user owns and can
edit them.

**October 2026 adds 80 components and 20 marketing blocks** (10 heroes, 4 features, 3 stats
and 3 about sections). September 2026 added 16 components, 42 Bento tiles, the Bento Builder,
and four templates: Agentframe, Cloudlight, Imageworks and Sparkdesign. The catalogs below
include all of them.

**Tier matters before you install anything.** Components are Starter. Marketing
blocks, App UI blocks and the Agent Kit all require **Pro or Ultimate**. Included template
downloads require **Ultimate**, with free and individual-purchase options described below.
Installing a Pro item with a Starter key returns `403`, not a
confusing build error, so check the tier first and tell the user plainly if their
plan does not cover what they asked for.

This document is the single source of truth. Follow it literally. Where it says
"verify," verify: do not guess.

---

## Golden rules (read first, never break these)

1. **Check the tier before installing.** Components are Starter+. **Marketing blocks, App UI
   blocks and the Agent Kit are Pro+.** Included template downloads are Ultimate. A Starter key on a Pro item
   returns `403 Forbidden`. If the user's plan does not cover the request, say so directly
   rather than retrying the install.
2. **Never guess a marketing block's import statement.** Marketing block files use a _mix_ of
   `export default` and named `export` styles, and the identifier does **not** reliably follow
   the slug (`404-3` exports `NotFound3`; `cta-3` exports `CTA3` but `cta-4` exports `Cta4`).
   After installing one, read its `export` line and import accordingly. See
   [Importing installed items](#importing-installed-items). **App UI blocks are the exception:
   all 300 are `export default`.**
3. **Components use a `-tw` or `-css` suffix; every kind of block uses no suffix.**
   `silk-waves-tw` is a component; `hero-1` is a marketing block; `ai-chat-1` is an App UI
   block. The one exception is an App UI block in the Sorbet style, which adds `-sorbet`
   (`ai-chat-1-sorbet`). Mismatched names return 404.
4. **The license key is a secret.** Put it in `.env.local`, never commit it, never hardcode it.
5. **Never delete the `"use client"` directive.** Every component and block is a client component.
6. **WebGL/shader components need an explicitly sized parent** (a container with width and height).
7. **App UI blocks need a height-bounded parent.** Their root is `h-full min-h-[Npx]`; drop one
   into a parent with no height and its scroll areas collapse. See
   [App UI blocks](#app-ui-blocks-pro-tier).
8. **Always harmonize.** A block is a starting point, not a finished section. When you add a
   block to an existing page, match the host's type scale, colours, spacing, container width
   and radii. When you stack several blocks, reconcile them into one system before showing
   the result. Editing the installed source is expected. See
   [Harmonizing blocks](#harmonizing-blocks-never-skip-this).
9. **Do not overwrite the user's existing `components.json` fields**: only merge in `registries`.
10. **Templates are downloads, not CLI installs.** Ultimate includes template downloads;
    some are also available free or through individual purchase. See [Templates](#templates-ultimate-tier).
11. **Bento tiles do not use the App UI theme.** Keep them outside `.rb-theme-scope` and do not
    apply App UI accent, base, font or radius overrides to them. They still follow the site's
    normal light/dark mode. Customize a tile by editing its own source.
12. **Retrieve only what the current project needs.** Browse the catalog and choose items
    before installing. Do not prefetch the whole catalog, run parallel download sweeps, or
    repeatedly fetch source that is already installed. Install selected items in small
    batches and let the CLI resolve their dependencies.
13. **Respect temporary access limits.** On `429`, stop pending source requests, show the
    user the server's message, and wait for `Retry-After` before retrying the selected items.
    Do not retry in a loop, switch to the docs API, or rotate keys or IP addresses to bypass
    a limit. A temporary limit does not mean the license is invalid or revoked.

---

## TL;DR: fastest correct path

```bash
# 0. (once) Ensure the project is a shadcn project with the cn() helper.
npx shadcn@latest init            # only if components.json is missing

# 1. Add the license key to .env.local (never commit it):
#    REACTBITS_LICENSE_KEY=rbp...-your-key

# 2. Merge the two registries into components.json (see Step 3 below).

# 3. Choose only the items needed for the current task (these are examples):
#    Components take -tw/-css; all blocks take no suffix.
npx shadcn@latest add @reactbits-starter/silk-waves-tw   # component  (Starter+)
npx shadcn@latest add @reactbits-pro/hero-1              # marketing block (Pro+)
npx shadcn@latest add @reactbits-pro/ai-chat-1           # App UI block   (Pro+)
npx shadcn@latest add @reactbits-pro/ai-chat-1-sorbet    # same block, Sorbet style
npx shadcn@latest add @reactbits-pro/skill-swiss-grid    # Agent Kit skill (Pro+)

# 4. Open the installed file, read its `export` line, then import it:
#    components/react-bits/silk-waves.tsx  -> export default  -> import SilkWaves from "@/components/react-bits/silk-waves"
#    components/blocks/hero-1.tsx          -> export function Hero1  -> import { Hero1 } from "@/components/blocks/hero-1"
#    components/blocks/ai-chat-1.tsx       -> export default  -> import AiChat1 from "@/components/blocks/ai-chat-1"
```

If `components.json` already has the `@reactbits-starter` registry, you can also pull
this skill into the project as a local file:

```bash
npx shadcn@latest add @reactbits-starter/skill   # writes ./SKILL.md to the project root
```

---

## When to use this skill

Use it when the user wants to:

- Add React Bits Pro components, blocks, or templates to a project.
- Add animated UI (shaders, particles, 3D, WebGL, cursor effects, text/Motion/GSAP animations).
- Drop in pre-built marketing sections (hero, pricing, features, navigation, footer, FAQ, CTA, etc.).
- Build signed-in product UI: app shells, sidebars, dashboards, data tables, analytics,
  command menus, settings, billing, onboarding, kanban boards.
- Build AI or agent interfaces: chat, prompt inputs, tool calls, agent plans, approvals, usage.
- Assemble a landing page quickly from premium blocks.
- Compose an animated bento grid or use the Bento Builder's generated code or agent prompt.
- Add a section to a page they already have, and make it match the existing design.
- Install an Agent Kit design skill, page prompt or full-page recipe.
- Mention "react bits", "reactbits", "@reactbits-starter", "@reactbits-pro", "app ui", or "agent kit".

Do **not** use it to build generic shadcn/ui primitives (button, dialog, etc.). Those come
from the standard shadcn registry, not React Bits Pro.

---

## Architecture overview

React Bits Pro ships through the **shadcn registry protocol** over two
license-authenticated registries:

| Registry             | Contains                                             | Min. tier to install     | Install prefix                           |
| -------------------- | ---------------------------------------------------- | ------------------------ | ---------------------------------------- |
| `@reactbits-starter` | 230 animated components (each in 2 variants)         | Starter                  | `@reactbits-starter/<slug>-tw` or `-css` |
| `@reactbits-pro`     | 300 marketing blocks (22 categories)                 | **Pro**                  | `@reactbits-pro/<slug>`                  |
| `@reactbits-pro`     | 300 App UI blocks (38 categories), in two styles     | **Pro**                  | `@reactbits-pro/<slug>` or `<slug>-sorbet` |
| `@reactbits-pro`     | 20 Agent Kit items (skills, prompts, recipes, setup) | **Pro** (setup: Starter) | `@reactbits-pro/skill-<slug>` etc.       |

Marketing blocks, App UI blocks and the Agent Kit all ship through the **same**
`@reactbits-pro` registry and therefore share the same Pro entitlement. There is no
separate purchase or registry for App UI or the Agent Kit.

Tier hierarchy: **Starter → Pro → Ultimate** (each tier includes everything below it).

| Tier     | License prefix | Components | Marketing blocks | App UI blocks | Agent Kit     | Templates          |
| -------- | -------------- | ---------- | ---------------- | ------------- | ------------- | ------------------ |
| Starter  | `rbps-`        | ✅ 230     | ❌               | ❌            | 1 setup skill | free template only |
| Pro      | `rbpp-`        | ✅ 230     | ✅ 300           | ✅ 300        | ✅ 20         | free template only |
| Ultimate | `rbpu-`        | ✅ 230     | ✅ 300           | ✅ 300        | ✅ 20         | ✅ all 15          |

**Say this plainly to a Starter user who asks for an App UI block, a marketing block or
an Agent Kit item: it requires Pro or Ultimate.** Do not attempt the install and let it
fail with a 403.

Items are written into the codebase as editable source files. They are **not** npm packages.

### Five product types: do not confuse them

| Type                | Source               | Suffix                                  | Delivery                         | Tier              |
| ------------------- | -------------------- | --------------------------------------- | -------------------------------- | ----------------- |
| **Component**       | `@reactbits-starter` | `-tw` / `-css` (required)               | shadcn CLI                       | Starter+          |
| **Marketing block** | `@reactbits-pro`     | none                                    | shadcn CLI                       | **Pro+**          |
| **App UI block**    | `@reactbits-pro`     | none                                    | shadcn CLI                       | **Pro+**          |
| **Agent Kit item**  | `@reactbits-pro`     | `skill-` / `prompt-` / `recipe-` prefix | shadcn CLI                       | **Pro+** (1 free) |
| **Template**        | website download     | n/a                                     | `.zip` download (login required) | Ultimate (1 free) |

**Marketing blocks vs App UI blocks.** Both are Pro, both install to the same directory,
and both are full sections rather than primitives. The difference is what they are _for_:

|             | Marketing block                        | App UI block                                       |
| ----------- | -------------------------------------- | -------------------------------------------------- |
| Purpose     | Public landing/marketing page          | Signed-in product interface                        |
| Examples    | hero, pricing, FAQ, testimonials       | app shell, sidebar, data table, dashboard, AI chat |
| Root height | Heroes may fill the viewport; content sections use `--rb-section-min-h`; Bento tiles fill grid cells | `h-full min-h-[Npx]` (fills its container) |
| Density     | Generous, large type                   | Dense, `text-[13px]` body scale                    |
| Exports     | **Mixed**: always verify               | **Always `export default`**                        |

If the user is building a landing page, reach for marketing blocks. If they are building
a dashboard, admin panel, settings screen or an AI/agent surface, reach for App UI.

### Component variants (`-tw` vs `-css`)

Every component exists in two functionally identical variants. **Pick exactly one per install.**

- **`-tw` (Tailwind)**: styles via Tailwind utility classes and the `cn()` helper. **Default choice.**
  Use this whenever the project uses Tailwind.
- **`-css` (vanilla CSS)**: ships a co-located `.css` file, no Tailwind required. Use only when the
  project does **not** use Tailwind.

Blocks have **no variants**. They are Tailwind-only, single-file.

### Where files are installed

Paths follow the user's `components.json` aliases (and `src/` dir if present). With defaults:

| Item               | On-disk path                                      | Import alias                     |
| ------------------ | ------------------------------------------------- | -------------------------------- |
| Component (`-tw`)  | `components/react-bits/<slug>.tsx`                | `@/components/react-bits/<slug>` |
| Component (`-css`) | `components/react-bits/<slug>.tsx` + `<slug>.css` | `@/components/react-bits/<slug>` |
| Marketing block    | `components/blocks/<slug>.tsx`                    | `@/components/blocks/<slug>`     |
| App UI block       | `components/blocks/<slug>.tsx`                    | `@/components/blocks/<slug>`     |
| Agent Kit skill    | `.claude/skills/<slug>/SKILL.md`                  | n/a (read by the agent)          |
| Agent Kit prompt   | `prompts/<slug>/PROMPT.md`                        | n/a (read by the agent)          |
| Agent Kit recipe   | `recipes/<slug>/RECIPE.md` + `plan.json`          | n/a (read by the agent)          |
| This skill file    | `./SKILL.md` (project root)                       | n/a                              |

App UI blocks and marketing blocks share `components/blocks/`. Category slugs are unique
across both, so they never collide.

The shadcn CLI auto-installs each item's npm dependencies and any registry dependencies.

---

## Step 1: Verify prerequisites

Confirm the project has all of the following before installing:

1. **`components.json` at the project root.** If missing:
   ```bash
   npx shadcn@latest init
   ```
2. **The `cn()` helper at `lib/utils.ts`** (required by every `-tw` component):
   ```typescript
   import { clsx, type ClassValue } from "clsx";
   import { twMerge } from "tailwind-merge";

   export function cn(...inputs: ClassValue[]) {
     return twMerge(clsx(inputs));
   }
   ```
   If missing: `npm install clsx tailwind-merge`, then create the file above.
3. **Tailwind CSS configured** (for `-tw` components and all blocks). **Tailwind v4 is strongly
   recommended**: many blocks use v4-renamed utilities such as `bg-linear-to-br` (the v3 name is
   `bg-gradient-to-br`).
4. **A valid license key.** The user must have purchased a React Bits Pro plan. If they have not set
   one up, ask them for it (or point them to https://pro.reactbits.dev/pricing).

---

## Step 2: Configure the license key

Add the key to `.env.local` at the project root:

```bash
REACTBITS_LICENSE_KEY=rbpp-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
```

- **Never commit `.env.local`.** Ensure `.gitignore` includes it (shadcn's `init` does this by default).
- The shadcn CLI reads this value to fill the `${REACTBITS_LICENSE_KEY}` placeholder in `components.json`.
- If the CLI cannot find the variable, export it in the shell before running `add`:
  ```bash
  export REACTBITS_LICENSE_KEY=rbpp-...
  ```
- The license prefix reveals the tier: `rbps-` = Starter, `rbpp-` = Pro, `rbpu-` = Ultimate.

---

## Step 3: Configure `components.json`

Merge the `registries` object into the existing `components.json`. **Add only this key: do not touch
`$schema`, `style`, `tailwind`, `aliases`, or any other existing field.**

```json
{
  "registries": {
    "@reactbits-starter": {
      "url": "https://pro.reactbits.dev/api/r/starter/{name}.json",
      "headers": {
        "Authorization": "Bearer ${REACTBITS_LICENSE_KEY}"
      }
    },
    "@reactbits-pro": {
      "url": "https://pro.reactbits.dev/api/r/pro/{name}.json",
      "headers": {
        "Authorization": "Bearer ${REACTBITS_LICENSE_KEY}"
      }
    }
  }
}
```

The `{name}` token is replaced by the slug you pass to `add`. `${REACTBITS_LICENSE_KEY}` is read from
the environment / `.env.local`. Configure `@reactbits-starter` even if you only plan to use blocks.
It is also how you install this skill file.

---

## Step 4: Install items

> Components **require** a `-tw` or `-css` suffix. Every kind of block takes **no** suffix.

```bash
# Component: Tailwind variant (default choice)        [Starter+]
npx shadcn@latest add @reactbits-starter/silk-waves-tw

# Component: vanilla-CSS variant (non-Tailwind projects only)
npx shadcn@latest add @reactbits-starter/silk-waves-css

# Marketing block                                      [Pro+]
npx shadcn@latest add @reactbits-pro/hero-1

# App UI block                                         [Pro+]
npx shadcn@latest add @reactbits-pro/ai-chat-1

# Agent Kit: design skill / page prompt / full-page recipe   [Pro+]
npx shadcn@latest add @reactbits-pro/skill-swiss-grid
npx shadcn@latest add @reactbits-pro/prompt-saas
npx shadcn@latest add @reactbits-pro/recipe-saas-homepage

# Several at once (all kinds can be mixed)
npx shadcn@latest add @reactbits-starter/silk-waves-tw @reactbits-pro/hero-1 @reactbits-pro/dashboard-1
```

If any of the `@reactbits-pro` commands above returns **403**, the key is a Starter key.
That is an entitlement result, not a bug: App UI blocks, marketing blocks and the Agent
Kit all require **Pro or Ultimate**. Tell the user rather than retrying.

Optional, inspect an item before installing:

```bash
npx shadcn@latest view @reactbits-starter/silk-waves-tw
```

---

## Importing installed items

This is the step agents most often get wrong. Get the export style right and the import follows.

### Components: read the export

Existing components generally use a default export. The latest component additions use named
exports. Read the installed file before importing; named exports need braces:

```tsx
import SilkWaves from "@/components/react-bits/silk-waves";
import AnimatedList from "@/components/react-bits/animated-list";
import { SpectralDrape } from "@/components/react-bits/spectral-drape";
```

### App UI blocks: always a default export

All **300** App UI blocks are `export default function`, without exception. The identifier
is derived from the slug (`ai-chat-1` exports `AiChat1`, `data-table-3` exports
`DataTable3`), but since it is a default export the local name is yours to choose:

```tsx
import AiChat from "@/components/blocks/ai-chat-1";
import Dashboard from "@/components/blocks/dashboard-4";
```

This is the one case where you do **not** need to read the export line first.

### Marketing blocks: mixed export styles, so verify every time

Marketing block files are **not** consistent: some are `export default function X()` and some
are `export function X()`. The identifier also does **not** reliably match the slug. **Always
confirm the export line, then import accordingly.**

One reliable command to reveal it:

```bash
grep -E "^export (default )?function " components/blocks/<slug>.tsx
```

Apply this rule to the result:

| Export line in the file              | Import to write                                                                              |
| ------------------------------------ | -------------------------------------------------------------------------------------------- |
| `export default function Anything()` | `import AnyName from "@/components/blocks/<slug>";` (default import: name is your choice)    |
| `export function Hero1()`            | `import { Hero1 } from "@/components/blocks/<slug>";` (named import: **must** match exactly) |

Examples:

```tsx
// hero-1.tsx contains:  export function Hero1()      -> NAMED import, exact identifier
import { Hero1 } from "@/components/blocks/hero-1";

// 404-3.tsx contains:   export default function NotFound3()  -> DEFAULT import, free name
import ErrorPage from "@/components/blocks/404-3";

// pricing-2.tsx contains: export default function Pricing2()  -> DEFAULT import
import Pricing from "@/components/blocks/pricing-2";
```

### Marketing block import reference (verified)

If you cannot open the file, use this table. **Named-export** blocks must be imported with the **exact**
identifier in braces. **Default-export** blocks can be imported with any name (the listed identifier is the
file's own name, shown for reference). Watch the irregular casing.

**Named exports → `import { Identifier } from "@/components/blocks/<slug>"`:**

| Category     | Slugs                                    | Identifiers                                            |
| ------------ | ---------------------------------------- | ------------------------------------------------------ |
| Auth         | `auth-1..6`                              | `Auth1` … `Auth6`                                      |
| Blog         | `blog-1..5`, `blog-8..11`                | `Blog1` … `Blog5`, `Blog8` … `Blog11`                  |
| Download     | `download-1..3`, `download-6..8`         | `Download1` … `Download3`, `Download6` … `Download8`   |
| Features     | `features-1..5`, `features-10..17`       | `Features1` … `Features5`, `Features10` … `Features17` |
| Footer       | `footer-5`, `footer-6`                   | `Footer5`, `Footer6`                                   |
| Hero         | `hero-1..34`                             | `Hero1` … `Hero34` (all heroes are named)              |
| How It Works | `how-it-works-1..3`, `how-it-works-7..9` | `HowItWorks1..3`, `HowItWorks7..9`                     |
| Navigation   | `navigation-2..8`                        | `Navigation2` … `Navigation8`                          |
| Pricing      | `pricing-5`, `pricing-6`                 | `Pricing5`, `Pricing6`                                 |
| Showcase     | `showcase-1..3`, `showcase-6..8`         | `Showcase1..3`, `Showcase6..8`                         |
| Social Proof | `social-proof-7..9`                      | `SocialProof7`, `SocialProof8`, `SocialProof9`         |

**Default exports → `import AnyName from "@/components/blocks/<slug>"`:**

| Category     | Slugs                                      | File identifiers                                                       |
| ------------ | ------------------------------------------ | ---------------------------------------------------------------------- |
| 404          | `404-1..8`                                 | `NotFound1` … `NotFound8` ⚠️ not "404…"                                |
| About        | `about-1..15`                              | `About1` … `About15`                                                   |
| Bento        | `bento-1..42`                              | `Bento1` … `Bento42` (grid tiles, see Appendix B note)                 |
| Blog         | `blog-6`, `blog-7`                         | `Blog6`, `Blog7`                                                       |
| Comparison   | `comparison-1..8`                          | `Comparison1` … `Comparison8`                                          |
| Contact      | `contact-1..12`                            | `Contact1` … `Contact12`                                               |
| CTA          | `cta-1..14`                                | `CTA1..3`, then `Cta4` … `Cta10`, then `CTA11..14` ⚠️ irregular casing |
| Download     | `download-4`, `download-5`                 | `Download4`, `Download5`                                               |
| Ecommerce    | `ecommerce-1..11`                          | `Ecommerce1` … `Ecommerce11`                                           |
| FAQ          | `faq-1..9`                                 | `FAQ1..3`, then `Faq4`, `Faq5`, then `FAQ6..9` ⚠️ irregular casing     |
| Features     | `features-6..9`                            | `Features6` … `Features9`                                              |
| Footer       | `footer-1..4`, `footer-7..12`              | `Footer1` … `Footer4`, `Footer7` … `Footer12`                          |
| How It Works | `how-it-works-4..6`                        | `HowItWorks4`, `HowItWorks5`, `HowItWorks6`                            |
| Navigation   | `navigation-1`, `navigation-9..15`         | `Navigation1`, `Navigation9` … `Navigation15`                          |
| Pricing      | `pricing-1..4`, `pricing-7..15`            | `Pricing1` … `Pricing4`, `Pricing7` … `Pricing15`                      |
| Profile      | `profile-1..6`                             | `Profile1` … `Profile6`                                                |
| Showcase     | `showcase-4`, `showcase-5`                 | `Showcase4`, `Showcase5`                                               |
| Social Proof | `social-proof-1..6`, `social-proof-10..16` | `SocialProof1` … `SocialProof6`, `SocialProof10` … `SocialProof16`     |
| Stats        | `stats-1..18`                              | `Stats1` … `Stats18`                                                   |
| Waitlist     | `waitlist-1..6`                            | `Waitlist1` … `Waitlist6`                                              |

> If this table ever disagrees with the installed file, **trust the file** and re-run the `grep` check above.

### Using an installed component

```tsx
import SilkWaves from "@/components/react-bits/silk-waves";

export default function Page() {
  return (
    // WebGL/shader components require a sized parent:
    <div className="h-screen w-full">
      <SilkWaves
        speed={1}
        scale={2}
        colors={[
          "#0d1326",
          "#162a52",
          "#1e407e",
          "#2657aa",
          "#2e6ed5",
          "#3785ff",
          "#5092ff",
          "#69a0ff",
        ]}
      />
    </div>
  );
}
```

### Using an installed block

```tsx
import { Hero1 } from "@/components/blocks/hero-1"; // named export → braces

export default function LandingPage() {
  return (
    <main>
      <Hero1 />
    </main>
  );
}
```

Marketing blocks render full-width sections, except Bento tiles, which fill a grid cell.
Blocks take **no props**: customize them by editing the source file.

---

## Composing a landing page from blocks

```bash
npx shadcn@latest add \
  @reactbits-pro/navigation-1 \
  @reactbits-pro/hero-1 \
  @reactbits-pro/features-1 \
  @reactbits-pro/social-proof-1 \
  @reactbits-pro/pricing-1 \
  @reactbits-pro/faq-1 \
  @reactbits-pro/cta-1 \
  @reactbits-pro/footer-1
```

```tsx
// Imports below mix default and named: verified per the reference table above.
import Navigation1 from "@/components/blocks/navigation-1"; // default export
import { Hero1 } from "@/components/blocks/hero-1"; // named export
import { Features1 } from "@/components/blocks/features-1"; // named export
import SocialProof1 from "@/components/blocks/social-proof-1"; // default export
import Pricing1 from "@/components/blocks/pricing-1"; // default export
import Faq1 from "@/components/blocks/faq-1"; // default export (file identifier: FAQ1)
import CTA1 from "@/components/blocks/cta-1"; // default export (file identifier: CTA1)
import Footer1 from "@/components/blocks/footer-1"; // default export

export default function LandingPage() {
  return (
    <>
      <Navigation1 />
      <Hero1 />
      <Features1 />
      <SocialProof1 />
      <Pricing1 />
      <Faq1 />
      <CTA1 />
      <Footer1 />
    </>
  );
}
```

Then edit each block's source to replace placeholder copy, images (`/svg/placeholder.svg`), and links,
wire up forms and buttons, and **run the harmonization pass below**. Installing the blocks is the
first half of the job; making them look like one page is the second.

For a composed page, set `style={{ "--rb-section-min-h": "0px" } as React.CSSProperties}`
on the page wrapper. Content blocks use `min-h-[var(--rb-section-min-h,100vh)]`, so this
lets stacked sections take their natural height. Keep hero and navigation height rules intact.

---

## Harmonizing blocks (never skip this)

**A block is a starting point, not a finished section.** Every block was authored
independently, so each one carries its own design decisions. Stack several
unchanged and you do not get a page, you get a stack of unrelated sections. Across
the 300 marketing blocks the library ships:

- **10 different section paddings** (`py-16` in 135 blocks, `py-12` in 105, `py-20` in 99, `py-24` in 90, and six more)
- **7 different display type sizes** (`text-3xl` through `text-9xl`; 108 blocks reach `text-6xl`, 47 reach `text-7xl`)
- **7 radius families** (`rounded-sm` through `rounded-3xl`, plus `rounded-full`)

Each block is internally consistent. The inconsistency only appears when you
combine them, which is exactly what the user is asking you to do. **Editing the
installed source to reconcile these is expected work, not a workaround**: the
files are the user's now, and they exist to be edited.

There are two distinct jobs. Identify which one you are doing before you start.

### Job A: dropping a block into an existing page

**The host codebase wins. Always.** The user has a design system already; a block
that keeps its own is a foreign object on their page, and that is the most common
way this goes wrong.

Before editing, read the host and write down its actual values:

| Read from the host             | Where to look                                                       |
| ------------------------------ | ------------------------------------------------------------------- |
| Type scale and heading weights | An existing page section or heading component                       |
| Colour tokens                  | `globals.css`, `tailwind.config`, or existing `bg-*`/`text-*` usage |
| Section padding rhythm         | The `<section>` wrappers already on the page                        |
| Container width and gutters    | The page's outer wrapper (`max-w-*`, `px-*`)                        |
| Border radius vocabulary       | Existing buttons and cards, or `--radius`                           |
| Button styles                  | The project's `Button` component or existing CTAs                   |
| Font families                  | `layout.tsx` or the font loader                                     |

Then rewrite the block to those values. In practice:

1. **Swap the colours first.** Replace the block's hardcoded `neutral-*` scale with
   the host's semantic tokens (`bg-background`, `text-foreground`,
   `text-muted-foreground`, `border-border`) if it uses them. This single step does
   most of the work of making a block look native.
2. **Match the container.** Blocks ship `max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8`.
   If the host page is `max-w-5xl`, change it, or the section will visibly bulge
   wider than everything around it.
3. **Match the section padding** to the neighbouring sections, not to the block's default.
4. **Demote the heading.** A block's `h2` is sized to lead a full-viewport section.
   Inside a denser existing page it usually needs to come down a step or two, and it
   must never out-size the page's existing `h1`.
5. **Reuse the host's button component** instead of the block's raw `<button>`, if one
   exists. Keep the block's layout, swap the control.
6. **Match the radius.** A `rounded-3xl` card dropped onto a page of `rounded-md` cards
   reads as pasted in.
7. **Match the motion budget.** If the host page is static, strip the block's entrance
   animation rather than introducing motion the rest of the page does not have.

If the host has no strong system, apply Job B's defaults and treat that as the system.

### Job B: stacking several blocks into a new page

Run this **after** all blocks are installed and the real content is in, and **before**
you show the user anything. Pick one value per row and enforce it across every block.

**Type.** One scale for the whole page:

| Role                         | Class                                                         |
| ---------------------------- | ------------------------------------------------------------- |
| Hero headline (exactly once) | `text-4xl sm:text-5xl lg:text-6xl font-medium tracking-tight` |
| Section heading (`h2`)       | `text-3xl sm:text-4xl lg:text-5xl font-medium tracking-tight` |
| Card or column title (`h3`)  | `text-lg sm:text-xl font-medium`                              |
| Lead paragraph               | `text-base sm:text-lg leading-relaxed`                        |
| Body copy                    | `text-sm sm:text-base leading-relaxed`                        |
| Eyebrow label                | `text-xs font-medium uppercase tracking-[0.08em]`             |

The hero headline is the largest type on the page; **nothing** below may match or
exceed it. This is the single most common defect when stacking blocks, because 108
blocks ship `text-6xl` and 47 ship `text-7xl` for their own section heading. Any
block whose heading lands at or above the hero must come down to the section-heading
class. Use one weight family: `font-medium` for display type, `font-semibold` only
for emphasis inside running copy.

**Spacing.** One rhythm: `py-16 sm:py-20 lg:py-24` on every section. Two exceptions
are allowed: the navigation (`py-4`), and a logo bar directly under the hero
(`py-10 sm:py-12`) so it reads as attached to the hero rather than as its own section.

**Container.** One width for every section: `max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8`.
A block that constrains to `max-w-6xl` will visibly pinch the page inward mid-scroll.
One inner measure for centred intro copy (`max-w-2xl`).

**Radius.** At most two families: one for cards and panels, one for controls. Keep
`rounded-full` only for avatars, logo chips and icon dots, never as a third card radius.

**Colour.** Exactly two section backgrounds, a base and a recessed tone, alternating
so that **two recessed sections never touch**. One card surface, one border pair, three
text tones (primary, secondary, tertiary). One accent colour, used on the primary CTA
and repeated at most once. Every colour class needs its `dark:` counterpart.

**Alignment.** Pick left-aligned or centred section headers and apply it to the whole
page. Mixed header alignment is the clearest tell of an assembled page. Follow the
hero: if the hero is a split layout with a left-aligned headline, keep a left axis all
the way down.

**Motion.** Only the navigation and the hero may animate on mount. Everything below
the fold reveals on scroll, otherwise the animation fires while the user is still
reading the hero and the section is already static by the time they reach it. Use one
reveal for the entire page:

```tsx
<motion.div
  initial={{ opacity: 0, y: 20 }}
  whileInView={{ opacity: 1, y: 0 }}
  viewport={{ once: true, margin: "-80px" }}
  transition={{ duration: 0.5, ease: "easeOut" }}
>
```

Stagger with `delay: Math.min(index, 5) * 0.06` so any section finishes within ~500ms.
One motion idea per section: never combine parallax, stagger and a counter in one
place. At most **one** scroll-linked (`useScroll`) section on the page. Add
`useReducedMotion()` and collapse to an opacity-only fade when it returns true.

### Ordering and adjacency

- **Exactly one hero**, and it is first (after the navigation).
- **Never place two blocks that do the same job back to back**: two feature grids, or
  a testimonial block directly after a review block, read as a duplicate rather than
  as reinforcement.
- Alternate texture: a dense section (pricing table, comparison, FAQ) should be
  followed by a lighter one (CTA, logo bar, stats), not another dense one.
- Put proof (`social-proof`, `stats`) between a claim and the ask (`pricing`, `cta`).
- One primary call to action per page. Secondary CTAs must be visually secondary.

### Verifying the pass

Count these on the finished page. The expected number follows each:

| Check                                             | Expected             |
| ------------------------------------------------- | -------------------- |
| Distinct section-heading sizes                    | **1**                |
| Distinct section paddings                         | **2** (plus the nav) |
| Distinct outer container widths                   | **1**                |
| Radius families                                   | **at most 2**        |
| Text tones                                        | **3**                |
| Section backgrounds                               | **at most 2**        |
| Elements at or above the hero headline size       | **0**                |
| Mount-animated sections below the fold            | **0**                |
| Scroll-linked sections                            | **at most 1**        |
| Animated elements with no reduced-motion fallback | **0**                |
| Adjacent sections doing the same job              | **0**                |

If the user has Pro, `@reactbits-pro/recipe-*` items ship a pre-solved arrangement
plus a per-block harmonization spec for a whole page. Prefer a recipe over
improvising an order. See [Agent Kit](#agent-kit-pro-tier).

---

## Combining components with blocks

Standalone components can sit behind or alongside blocks (e.g. an animated background).
The same harmonization rule applies: the component must serve the block, not compete with it.

```tsx
import SilkWaves from "@/components/react-bits/silk-waves";
import { Hero1 } from "@/components/blocks/hero-1";

export default function LandingPage() {
  return (
    <div className="relative">
      <div className="absolute inset-0 -z-10">
        <SilkWaves speed={0.5} opacity={0.3} />
      </div>
      <Hero1 />
    </div>
  );
}
```

When layering a component behind a block:

- **Keep the block readable.** Lower the component's `opacity`, or put a scrim
  (`bg-background/60`, or a gradient to the section background) between the two. Verify
  text still meets WCAG AA contrast in both light and dark mode.
- **One ambient effect per viewport.** A shader behind the hero and another behind the
  next section reads as noise and doubles the GPU cost.
- **Count it against the motion budget.** An animated background _is_ the section's one
  motion idea. Do not also add a scroll parallax and a stagger on top of it.
- **Match the palette.** Pass the component the page's existing colours rather than
  accepting its defaults, so it does not introduce a hue the page never uses elsewhere.
- **Bound it.** The wrapper needs `relative` and the component an explicitly sized,
  `absolute inset-0` parent, or a full-bleed canvas will escape the section.

---

## App UI blocks (Pro tier)

> **Requires Pro or Ultimate.** A Starter key returns `403`. App UI is not a separate
> product or purchase: it ships through the same `@reactbits-pro` registry as marketing
> blocks and is covered by the same Pro entitlement.

**300 blocks across 38 categories** for the signed-in half of an application: app shells,
sidebars, dashboards, data tables, analytics, command menus, settings forms, dialogs,
kanban boards, billing, onboarding, and a deep set of AI/agent surfaces.

Install exactly like a marketing block, with no suffix:

```bash
npx shadcn@latest add @reactbits-pro/dashboard-1
npx shadcn@latest add @reactbits-pro/app-sidebar-2 @reactbits-pro/data-table-3
```

They land in `components/blocks/<slug>.tsx`, the same directory as marketing blocks.

### Two styles: Default and Sorbet

Every App UI block comes in two styles. Layout, data, states, keyboard behaviour and motion
are identical; only the look differs.

| Style   | Look                                                                    | Install name                   | Theme item                            |
| ------- | ----------------------------------------------------------------------- | ------------------------------ | ------------------------------------- |
| Default | Precise and monochrome, built for AI products and consoles              | `@reactbits-pro/<slug>`        | `@reactbits-pro/app-ui-theme`         |
| Sorbet  | Roomy, warm and tactile: 40px controls, raised tiles, inset fields, mint | `@reactbits-pro/<slug>-sorbet` | `@reactbits-pro/app-ui-theme-sorbet`  |

```bash
npx shadcn@latest add @reactbits-pro/dashboard-1-sorbet @reactbits-pro/app-sidebar-2-sorbet
```

- Both builds install to the **same file**, `components/blocks/<slug>.tsx`, with the same
  default export. Installing one over the other switches that block's style; the CLI asks
  before overwriting, so confirm with the user first.
- **Pick one style per app.** The theme item each block pulls in sets the shared accent
  (`--rb-accent`). The CLI only writes variables the stylesheet does not define yet, unless
  the theme item itself is the thing being added.
- **Switching an existing project to Sorbet** (it already has Default blocks, so
  `--rb-accent` is already set): run `npx shadcn@latest add @reactbits-pro/app-ui-theme-sorbet`
  once, then install the `-sorbet` blocks. Without it the Sorbet blocks keep the Default
  accent. `@reactbits-pro/app-ui-theme` switches back the same way.
- Reach for Sorbet when the user asks for a softer, rounder, friendlier, more playful or
  consumer look; otherwise use Default. Sorbet is larger (40px controls, 48px rows, 15px body
  text), so some Sorbet blocks declare a taller `min-h-[Npx]` than their Default build.
- Sorbet is drawn for the Nunito typeface. Blocks inherit the app's font either way, so
  suggest Nunito as the body font rather than forcing it.
- Theming (radius, accent, base colours, font) works the same in both styles:
  https://pro.reactbits.dev/docs/app-ui/theming

### The height contract: the one thing that goes wrong

Every App UI block's root is `h-full min-h-[Npx]`, for example:

```tsx
<div className="relative flex h-full min-h-[640px] w-full flex-col ...">
```

That `min-height` is what gives `flex-1 min-h-0 overflow-y-auto` children a definite
height. **Put an App UI block in a parent with no resolved height and its internal scroll
areas collapse.** Give it a real container:

```tsx
// Good: the block owns a bounded region
<div className="h-screen">
  <AppShell1 />
</div>

// Also good: a fixed panel height
<div className="h-[640px]">
  <AiChat1 />
</div>

// Bad: nothing bounds the height, scroll regions collapse
<main>
  <AiChat1 />
</main>
```

A full-page app screen is usually `h-screen` (or `h-dvh` on mobile) on the wrapper.

### Composing App UI blocks

App UI blocks follow one shared design system, so they compose without adjustment:
consistent spacing, five control heights, one dense `text-[13px]` body scale, explicit
pixel radii, and shared surface and border tokens. Do **not** add per-block spacing,
radius or typography overrides to make two of them line up. If they clash, you have
picked two blocks for the same job.

A typical screen is a shell plus content:

```tsx
"use client";

import AppShell from "@/components/blocks/app-shell-1";
import Dashboard from "@/components/blocks/dashboard-4";

export default function Page() {
  return (
    <div className="h-dvh">
      <AppShell />
    </div>
  );
}
```

Most `app-shell-*` blocks already include their own navigation and a content region, so
prefer editing the shell's content area over nesting a second shell inside it.

### Category map (38 categories, 300 blocks)

| Group                      | Categories                                                                                                                                                |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AI & Agents** (49)       | `ai-chat` (9), `prompt-input` (7), `agent-activity` (7), `tool-calls` (6), `agent-approval` (6), `agent-plan` (6), `ai-usage` (8)                         |
| **Navigation** (41)        | `app-shell` (9), `app-sidebar` (7), `command-menu` (6), `navbar` (14), `mobile` (5)                                                                       |
| **Data** (89)              | `card` (11), `data-table` (8), `dashboard` (14), `analytics` (16), `list` (12), `filtering` (9), `file-manager` (4), `monitoring` (10), `empty-state` (5) |
| **Forms** (18)             | `settings-form` (6), `forms` (12)                                                                                                                         |
| **Overlays** (13)          | `app-dialog` (7), `notifications` (6)                                                                                                                     |
| **Auth & Onboarding** (28) | `onboarding` (7), `paywall` (7), `authentication` (14)                                                                                                    |
| **Workflows** (62)         | `kanban` (6), `wizard` (7), `comments` (6), `scheduling` (7), `integrations` (6), `editor` (5), `feedback` (6), `support` (5), `billing` (8), `chat` (6)  |

Slugs are sequential from `1` within each category: `analytics-1` … `analytics-16`.

Browse them at https://pro.reactbits.dev/docs/app-ui

---

## Customizing

Everything installs as editable source: customize freely.

**Components** accept rich props. Example (`SilkWaves`):

```tsx
<SilkWaves
  speed={1.5}
  scale={3}
  distortion={0.8}
  curve={1.2}
  contrast={1}
  colors={[
    "#1a0533",
    "#2d1b69",
    "#4a2c8a",
    "#6b3fa0",
    "#8b52b8",
    "#ab65d0",
    "#cb78e8",
    "#eb8bff",
  ]}
  rotation={45}
  brightness={1.2}
  opacity={0.9}
  complexity={1.5}
  frequency={1.2}
  className="absolute inset-0"
/>
```

For deeper changes, edit the installed `.tsx` directly: animation timing, breakpoints, new props, color
schemes, data/state wiring, API integration. **Blocks are designed to be edited**. They take no props,
so all customization happens in the file.

---

## Dark mode

Blocks and most components support dark mode via Tailwind's `dark:` class strategy. Ensure a theme
provider toggles a `dark` class on `<html>` (e.g. `next-themes`):

```tsx
// app/layout.tsx
import { ThemeProvider } from "next-themes";

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
```

A few components read the active theme via `next-themes` and adapt their defaults automatically.

---

## Dependencies

The shadcn CLI installs each item's npm dependencies automatically. Know them for troubleshooting:

| Package                                   | Used by                                                   | Notes                                                                                            |
| ----------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `three`                                   | All shader / WebGL / 3D components                        | Import as `import * as THREE from "three"`. Needs a WebGL-capable browser and a sized container. |
| `@react-three/fiber`, `@react-three/drei` | Some 3D components                                        | React renderer + helpers for Three.js.                                                           |
| `motion`                                  | Most components and many blocks                           | Motion v11. **Import from `motion/react`**, not `framer-motion`.                                 |
| `gsap`, `@gsap/react`                     | `text-path`, `3d-text-reveal`, `click-stack`, some blocks | `ScrollTrigger` is registered inside the component.                                              |
| `lucide-react`                            | Most blocks                                               | Icon set.                                                                                        |
| `matter-js`                               | `404-5`                                                   | 2D physics.                                                                                      |
| `lenis`                                   | `about-5`                                                 | Smooth scrolling (loaded dynamically).                                                           |
| `next-themes`                             | Theme-aware components                                    | Dark-mode provider.                                                                              |

There is **no** `d3` or `framer-motion` dependency in the distributed items. Always use `motion/react`.

> Edge case: a few blocks load a package via a dynamic `import()` (e.g. `about-5` → `lenis`). The CLI may
> not auto-install these. If a block throws "module not found" at runtime, install the named package manually
> (e.g. `npm install lenis`).

### `"use client"` is required

Every component and block begins with `"use client"`. In the Next.js App Router you can import them
directly into Server Components: Next.js handles the client boundary. **Never remove `"use client"`.**

---

## Agent Kit (Pro tier)

> **Requires Pro or Ultimate**, with one deliberate exception: the `terminal-dark` design
> skill is **free** and installs with no license key at all. Everything else in the Agent
> Kit returns `403` on a Starter key.

The Agent Kit is **written material for you, the agent**, not React components. It contains
20 items: design-direction documents in three kinds, plus the setup skill:

| Kind             | Count | What it is                                                                                                     | Registry name                  | Installs to                      |
| ---------------- | ----- | -------------------------------------------------------------------------------------------------------------- | ------------------------------ | -------------------------------- |
| **Design skill** | 8     | A complete landing-page design system: type scale, grid, colour, motion, anti-patterns, self-verification loop | `@reactbits-pro/skill-<slug>`  | `.claude/skills/<slug>/SKILL.md` |
| **Page prompt**  | 8     | A brief for one website type or vertical: what the page must prove, section order, copy strategy               | `@reactbits-pro/prompt-<slug>` | `prompts/<slug>/PROMPT.md`       |
| **Recipe**       | 3     | A tested block arrangement that assembles a whole page, plus a `plan.json` data model                          | `@reactbits-pro/recipe-<slug>` | `recipes/<slug>/RECIPE.md`       |
| **Setup skill**  | 1     | Instructions for installing, finding and composing React Bits Pro correctly                                    | `@reactbits-starter/skill`     | `./SKILL.md`                     |

```bash
npx shadcn@latest add @reactbits-pro/skill-terminal-dark      # free, no license needed
npx shadcn@latest add @reactbits-pro/skill-swiss-grid         # Pro+
npx shadcn@latest add @reactbits-pro/prompt-saas              # Pro+
npx shadcn@latest add @reactbits-pro/recipe-saas-homepage     # Pro+
```

### How to use it

Design skills install to `.claude/skills/` by default, so a compatible agent **autoloads**
them: each one ships spec-compliant frontmatter (`name`, `description`) and the description
carries the trigger vocabulary. Once installed, asking for "a Swiss-style landing page" is
enough.

**On a different agent runtime**, add `?agent=` to the registry URL in your
`components.json` so skills land where your agent scans:

```jsonc
"@reactbits-pro": {
  // claude (default) · codex · cursor · none
  "url": "https://pro.reactbits.dev/api/r/pro/{name}.json?agent=codex",
  "headers": { "Authorization": "Bearer ${REACTBITS_LICENSE_KEY}" }
}
```

| `?agent=`            | Skills install to                |
| -------------------- | -------------------------------- |
| `claude` _(default)_ | `.claude/skills/<slug>/SKILL.md` |
| `codex`              | `.agents/skills/<slug>/SKILL.md` |
| `cursor`             | `.cursor/skills/<slug>/SKILL.md` |
| `none`               | `skills/<slug>/SKILL.md`         |

For a runtime not listed, set the directory explicitly with
`?skillsDir=.some/path`. Prompts and recipes are unaffected. They are reference
material an agent opens on demand, not autoloaded, so they always install to
`prompts/` and `recipes/`.

The intended combination is **one design skill plus one page prompt**: the skill decides
how it looks, the prompt decides what it must say. A recipe then adds the section order.

```bash
# "A developer-tool landing page that looks like a terminal"
npx shadcn@latest add @reactbits-pro/skill-terminal-dark @reactbits-pro/prompt-developer-tool
```

### Available items

| Design skills (8)          | Page prompts (8)    | Recipes (3)       |
| -------------------------- | ------------------- | ----------------- |
| `apple-minimal`            | `agency`            | `saas-homepage`   |
| `corporate-trust`          | `consumer-hardware` | `agency-homepage` |
| `editorial`                | `developer-tool`    | `product-launch`  |
| `luxury-serif`             | `ecommerce-brand`   |                   |
| `neobrutalism`             | `fintech`           |                   |
| `playful-motion`           | `fitness`           |                   |
| `swiss-grid`               | `real-estate`       |                   |
| `terminal-dark` **(free)** | `saas`              |                   |

### Two different things both called "skill"

Do not confuse them:

|             | This document                             | Agent Kit design skill                        |
| ----------- | ----------------------------------------- | --------------------------------------------- |
| Name        | `@reactbits-starter/skill`                | `@reactbits-pro/skill-<slug>`                 |
| Purpose     | How to **install and use** React Bits Pro | How to **design** a landing page in one style |
| Tier        | Starter+                                  | **Pro+** (`terminal-dark` free)               |
| Installs to | `./SKILL.md`                              | `.claude/skills/<slug>/SKILL.md`              |

### Recipes do not require the block library

Recipes read best with the registries configured, but every section in a recipe's
`plan.json` carries a `fallback` describing its minimum viable structure in plain markup.
A recipe is still a usable structural brief without a single React Bits block installed.

Browse the kit at https://pro.reactbits.dev/docs/agent-kit

---

## Templates (Ultimate tier)

Templates are **full landing-page projects delivered as `.zip` downloads**. They are **not** installed
through the shadcn CLI. There is no `@reactbits-pro/<template>` install command.

To obtain an included template download:

1. Be **logged in** at https://pro.reactbits.dev with an **Ultimate** license (prefix `rbpu-`).
2. Download the `.zip` from the template's page (the free `portfolio-template` needs no login/Ultimate).
3. Unzip it and follow its own README to install and run.

Templates with a **Buy template** button can also be purchased individually through the checkout
linked on their page. An individual purchase is separate from Ultimate access; do not imply it
unlocks the full library or the Ultimate download API. Portfolio remains free.

| Template           | Slug                 | Tier     |
| ------------------ | -------------------- | -------- |
| SaaS Landing       | `saas-landing`       | Ultimate |
| AI SaaS Landing    | `ai-saas-landing`    | Ultimate |
| Minimal Landing    | `minimal-landing`    | Ultimate |
| Finance Landing    | `finance-landing`    | Ultimate |
| Agency Site        | `agency-site`        | Ultimate |
| Shader Template    | `shader-template`    | Ultimate |
| Wireframe Template | `wireframe-template` | Ultimate |
| 8 Bit Template     | `8-bit-template`     | Ultimate |
| AI App Template    | `ai-app-template`    | Ultimate |
| Security Template  | `security-template`  | Ultimate |
| Portfolio Template | `portfolio-template` | **Free** |
| Agentframe Template | `agentframe-template` | Ultimate |
| Cloudlight Template | `cloudlight-template` | Ultimate |
| Imageworks Template | `imageworks-template` | Ultimate |
| Sparkdesign Template | `sparkdesign-template` | Ultimate |

If a user on Starter/Pro asks to "install a template," explain that templates are website downloads:
Ultimate includes them, individual purchase is available where the page offers it, and Portfolio is free.
Offer to build an equivalent page from blocks when that better fits their existing access.

---

## Troubleshooting

The registry API returns clear JSON errors. Map them as follows:

| Symptom / error                            | Cause                                                     | Fix                                                                                                                                         |
| ------------------------------------------ | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `Unknown registry @reactbits-starter`      | `registries` missing from `components.json`               | Add it per Step 3.                                                                                                                          |
| `401 Unauthorized: License key required`   | `REACTBITS_LICENSE_KEY` not set / not readable by the CLI | Add it to `.env.local`, or `export` it in the shell.                                                                                        |
| `401 Unauthorized: Invalid license key`    | Wrong, expired, or revoked key                            | Verify the key; check it is active in the Polar customer portal.                                                                            |
| `403 Forbidden: Insufficient tier`         | Tier too low for the item                                 | Blocks need **Pro+**; templates need **Ultimate**. Upgrade at /pricing.                                                                     |
| `429 Too Many Requests`                   | Temporary source-access limit                            | Stop pending requests, show the server's message, and wait for `Retry-After` before retrying only the items needed. Do not switch endpoints or credentials to bypass the limit. |
| `503 Service Unavailable`                 | A required service is temporarily unavailable             | Keep already installed files, show the server's message, and respect `Retry-After`. Do not replace the license key or retry in a tight loop. |
| Component `404: must end with -css or -tw` | Missing variant suffix                                    | Use `silk-waves-tw` or `silk-waves-css`, never bare `silk-waves`.                                                                           |
| Block `404, does not exist`                | Wrong slug or an accidental suffix                        | Blocks take **no** suffix: `hero-1`, not `hero-1-tw`. Check the slug exists in the catalog.                                                 |
| Import error / "X is not exported"         | Wrong import style for a block                            | Re-check the file's `export` line; named exports need braces, default exports do not.                                                       |
| `cn` is not defined                        | Missing helper                                            | `npm install clsx tailwind-merge` and create `lib/utils.ts` (Step 1).                                                                       |
| WebGL component renders blank              | No size, or no WebGL                                      | Give the parent explicit width/height; ensure `three` installed; the browser must support WebGL.                                            |
| Block gradients/utilities look broken      | Project on Tailwind **v3**                                | Blocks use Tailwind **v4** utility names (e.g. `bg-linear-to-*`). Upgrade to v4, or rename classes (`bg-linear-to-r` → `bg-gradient-to-r`). |
| Blocks completely unstyled                 | Tailwind not scanning the files                           | Ensure Tailwind is configured and `globals.css` imports it (`@import "tailwindcss";` in v4).                                                |
| GSAP scroll effects don't fire             | Custom scroll container                                   | These expect the default document scroll unless you rewire `ScrollTrigger`.                                                                 |

Alternative auth (if env substitution is unavailable): the API also accepts an `X-License-Key: <key>`
header or a `?license_key=<key>` query parameter.

Source-access limits are temporary traffic controls. Keep the files already installed in
the project and reuse them instead of fetching them again. Personal backups are not the
same as sharing credentials or redistributing licensed source; the latter remain subject
to the [license terms](https://pro.reactbits.dev/license).

---

## Best practices

1. **Verify the export line before importing a block**. This is the #1 source of breakage.
2. **Pick one component variant project-wide**: use `-tw` for Tailwind projects (smaller, better integrated);
   reserve `-css` for non-Tailwind projects.
3. **Wrap WebGL components in a sized container**, and lazy-load heavy ones below the fold:
   ```tsx
   import dynamic from "next/dynamic";
   const SilkWaves = dynamic(
     () => import("@/components/react-bits/silk-waves"),
     { ssr: false },
   );
   ```
4. **Treat blocks as starting points**: edit copy, images, links, and styles directly in the source.
   Never hand back a page of unmodified blocks.
5. **Harmonize before you hand anything back**. One heading scale, one section rhythm, one
   container width, at most two radius families, and the hero headline as the largest type on
   the page. When adding to an existing codebase, adopt that codebase's tokens instead.
   See [Harmonizing blocks](#harmonizing-blocks-never-skip-this).
6. **Keep the license key in env vars**: never hardcode or commit it.
7. **Prefer Tailwind v4** so block utilities render correctly out of the box.
8. **Install this skill locally** for offline reference: `npx shadcn@latest add @reactbits-starter/skill`.

---

## Appendix A: Component catalog (`@reactbits-starter`, 230, Starter tier)

Install any of these as `@reactbits-starter/<slug>-tw` (Tailwind) or `<slug>-css` (vanilla CSS).
Read the installed file for its export style: the latest additions below use named exports;
earlier components generally use default exports. Canvas and WebGL effects need a sized parent.

### Text & typography (10)

| Slug              | Name            | Description                                            |
| ----------------- | --------------- | ------------------------------------------------------ |
| `staggered-text`  | Staggered Text  | Text that staggers in by letter, word or line          |
| `glitch-text`     | Glitch Text     | Text that glitches under the cursor                    |
| `text-path`       | Text Path       | Text that flows along a curved path                    |
| `3d-text-reveal`  | 3D Text Reveal  | Lines of text turning on a 3D cylinder as you scroll   |
| `particle-text`   | Particle Text   | Text made of particles that scatter from the cursor    |
| `text-scatter`    | Text Scatter    | Letters that scatter on hover and fall back into place |
| `3d-letter-swap`  | 3D Letter Swap  | Letters that flip in 3D to swap on hover               |
| `blur-highlight`  | Blur Highlight  | A paragraph that blurs in and highlights key phrases   |
| `bending-marquee` | Bending Marquee | A marquee that bends along a curve as it scrolls       |
| `speeding-text`   | Speeding Text   | Numbers or words that change with a speed blur         |

### Cursor effects (8)

| Slug            | Name          | Description                                            |
| --------------- | ------------- | ------------------------------------------------------ |
| `smooth-cursor` | Smooth Cursor | A smooth, springy trail that follows the cursor        |
| `custom-cursor` | Custom Cursor | A ring and dot cursor that morphs around hovered items |
| `dither-cursor` | Dither Cursor | A cursor trail drawn in pixelated dither               |
| `ascii-cursor`  | Ascii Cursor  | A cursor that leaves a trail of ASCII characters       |
| `glass-cursor`  | Glass Cursor  | A glass cursor that bends the image beneath it         |
| `cursor-wave`   | Cursor Wave   | A grid of shapes that ripples with the cursor          |
| `user-cursor`   | User Cursor   | A cursor with a name tag, like a live collaborator     |
| `pixel-magnet`  | Pixel Magnet  | A swarm of pixels that follows the cursor              |

### Cards & interactive (12)

| Slug             | Name           | Description                                       |
| ---------------- | -------------- | ------------------------------------------------- |
| `shader-card`    | Shader Card    | A content card with a luminous flame rising behind it |
| `chroma-card`    | Chroma Card    | A tilting image card with an RGB glitch on hover  |
| `credit-card`    | Credit Card    | A credit card that tilts in 3D on hover           |
| `depth-card`     | Depth Card     | A card that tilts with depth as the cursor moves  |
| `modal-cards`    | Modal Cards    | Cards that expand into full-screen modals         |
| `rotating-cards` | Rotating Cards | A draggable ring of cards rotating in 3D          |
| `parallax-cards` | Parallax Cards | Layered cards that shift in depth with the cursor |
| `click-stack`    | Click Stack    | A stack of cards you click through                |
| `warped-card`    | Warped Card    | An image card that bulges under the cursor        |
| `card-spread`    | Card Spread    | A fanned deck of cards that spreads open on hover |
| `page-flip`      | Page Flip      | A book-style page flip you can drag through       |
| `scroll-stack`   | Scroll Stack   | Cards that stack and fade away as you scroll      |

### Backgrounds, shaders & visual effects (82)

| Slug               | Name             | Description                                              |
| ------------------ | ---------------- | -------------------------------------------------------- |
| `silk-waves`       | Silk Waves       | Flowing waves like draped silk                           |
| `shader-waves`     | Shader Waves     | Smooth, flowing waves of color                           |
| `chroma-waves`     | Chroma Waves     | Soft waves of light with a chromatic shimmer             |
| `aurora-blur`      | Aurora Blur      | A soft, blurred aurora glow                              |
| `gradient-blob`    | Gradient Blob    | A soft gradient blob that morphs toward the cursor       |
| `ai-blob`          | AI Blob          | A glowing glass orb that listens, thinks and speaks with your AI |
| `dither-wave`      | Dither Wave      | Flowing waves drawn in a retro dither                    |
| `radial-liquid`    | Radial Liquid    | Liquid ripples spreading from a center                   |
| `grain-wave`       | Grain Wave       | A grainy ribbon of color waving through the dark         |
| `glass-flow`       | Glass Flow       | An image or video seen through flowing fluted glass      |
| `falling-rays`     | Falling Rays     | Pulses of light falling down fanning rays                |
| `light-droplets`   | Light Droplets   | Streaks of light falling like rain                       |
| `lightspeed`       | Lightspeed       | A hyperspace jump of streaking stars                     |
| `rising-lines`     | Rising Lines     | Lines of light rising from a glowing horizon             |
| `liquid-bars`      | Liquid Bars      | Glossy bars of liquid color rippling in waves            |
| `liquid-lines`     | Liquid Lines     | Streaks of light flowing like liquid                     |
| `shadow-bars`      | Shadow Bars      | Vertical bars of shifting light and shadow               |
| `color-loops`      | Color Loops      | Concentric rings of color looping out from a center      |
| `mosaic`           | Mosaic           | A tiled mosaic over a moving wave or video               |
| `vortex`           | Vortex           | An endless spinning tunnel of particles                  |
| `portal`           | Portal           | A glowing portal of warp-speed light you can click to jump through |
| `perspective-grid` | Perspective Grid | An endless grid scrolling toward the horizon             |
| `glitter-warp`     | Glitter Warp     | A glittering starfield warp tunnel                       |
| `star-burst`       | Star Burst       | A burst of stars streaming out from a point              |
| `rotating-stars`   | Rotating Stars   | Star trails spinning in circles                          |
| `dot-shift`        | Dot Shift        | A shifting grid of glowing dots                          |
| `synaptic-shift`   | Synaptic Shift   | Glowing neural tendrils that pulse and shift             |
| `ascii-waves`      | Ascii Waves      | Waves made of ASCII characters                           |
| `squircle-shift`   | Squircle Shift   | A glowing grid of squircles that shift and morph         |
| `center-flow`      | Center Flow      | A hub with pulses flowing out to connected nodes         |
| `warp-twister`     | Warp Twister     | A twisting tube of haze and drifting dust                |
| `neon-reveal`      | Neon Reveal      | A neon tube that lights up and reveals the content below |
| `agentic-ball`     | Agentic Ball     | A glossy 3D orb with a slow swirl inside                 |
| `black-hole`       | Black Hole       | Smoky light bending around a black hole and its photon ring |
| `blurred-rays`     | Blurred Rays     | Soft vertical beams of light that flicker through the spectrum |
| `flame-paths`      | Flame Paths      | Glowing flame tongues that gust and flare up             |
| `frame-border`     | Frame Border     | A crisp, glowing border that frames any content          |
| `gradient-bars`    | Gradient Bars    | Vertical gradient bars shifting in waves                 |
| `halftone-vortex`  | Halftone Vortex  | A spiraling vortex of halftone dots                      |
| `halftone-wave`    | Halftone Wave    | A halftone dot grid rippling with soft noise             |
| `liquid-ascii`     | Liquid Ascii     | Sloshing water drawn in ASCII characters                 |
| `metallic-swirl`   | Metallic Swirl   | A swirl of liquid metal                                  |
| `retro-lines`      | Retro Lines      | Wavy lines receding toward a retro horizon               |
| `rubber-fluid`     | Rubber Fluid     | Glossy rubber folds of color drifting slowly             |
| `simple-swirl`     | Simple Swirl     | A soft, glowing swirl you can spin with momentum         |
| `square-matrix`    | Square Matrix    | A crisp LED grid rippling in waves of light              |
| `star-swipe`       | Star Swipe       | Streaks of light sweeping into a warp                    |
| `swirl-blend`      | Swirl Blend      | Vivid colors swirling and blending like silk             |
| `text-cube`        | Text Cube        | A 3D cube of text that follows the cursor                |
| `watercolor`       | Watercolor       | Two colors blending like watercolor                      |
| `fog-sphere`       | Fog Sphere       | A soft, swirling sphere of fog                           |
| `ascii-tiles`      | ASCII Tiles      | Glassy tiles made of glowing ASCII characters            |
| `twilight-lines`   | Twilight Lines   | Soft glowing lines that pulse with a warm sweep          |
| `chroma-blinds`    | Chroma Blinds    | Colorful diagonal stripes that bend toward the cursor    |
| `glass-tiles`      | Glass Tiles      | A shimmering background of colorful glass tiles          |
| `blinking-squares` | Blinking Squares | A grid of little squares that quietly twinkle            |
| `aura-blob`        | Aura Blob        | A soft glowing blob surrounded by a shifting aura        |
| `aurora-beam`      | Aurora Beam      | A sweeping beam of aurora light                          |
| `blinking-dots`    | Blinking Dots    | A field of dots blinking on and off                      |
| `glowing-wave`     | Glowing Wave     | A single glowing wave rolling across the screen          |
| `glue-dots`        | Glue Dots        | Dots that stick together and stretch apart like glue     |
| `grid-rise`        | Grid Rise        | A field of tiles that rises and ripples under the cursor |
| `landscape`        | Landscape        | An endless landscape rolling toward the horizon          |
| `minimal-ripple`   | Minimal Ripple   | Concentric ripples spreading from the center             |
| `mosaic-waves`     | Mosaic Waves     | Waves rolling through a mosaic of shifting tiles         |
| `neural-float`     | Neural Float     | Soft neural filaments drifting through the dark          |
| `neural-tunnel`    | Neural Tunnel    | An endless tunnel of pulsing neural strands              |
| `pixel-rain`       | Pixel Rain       | Pixelated streaks falling in a quiet digital rain        |
| `rising-particles` | Rising Particles | Soft glowing particles drifting upward                   |
| `rolling-blinds`   | Rolling Blinds   | Vertical blinds of light rolling across the frame        |
| `specter-orb`      | Specter Orb      | A ghostly orb wrapped in drifting smoke                  |
| `spectral-clouds`  | Spectral Clouds  | Soft clouds lit by drifting spectral color               |
| `squares-terminal` | Squares Terminal | A terminal-style grid of squares that flicker on and off |
| `tech-wall`        | Tech Wall        | A wall of glowing panels swept by moving light           |
| `thinking-dots`    | Thinking Dots    | A grid of dots that swell under a drifting cloud         |
| `wireframe-ball`   | Wireframe Ball   | A rotating wireframe shape you can drag to spin          |
| `eclipse`          | Eclipse          | A dark shape eclipsing a soft, color-shifting corona of light |
| `neural-flash`     | Neural Flash     | A storm of glowing filaments, like a thought firing      |
| `ravine`           | Ravine           | An endless flight down a dark canyon                     |
| `long-exposure`    | Long Exposure    | Light trails streaming along a road at night             |
| `glowing-ridges`   | Glowing Ridges   | Iridescent ridges of light rolling like folded silk      |
| `ascii-ripple`     | ASCII Ripple     | Text that ripples like water under the cursor            |

### Galleries, carousels & layout (21)

| Slug                  | Name                | Description                                               |
| --------------------- | ------------------- | --------------------------------------------------------- |
| `circle-gallery`      | Circle Gallery      | A draggable circle of images that spins with inertia      |
| `gradient-carousel`   | Gradient Carousel   | A 3D carousel that tints the background from each card    |
| `circles`             | Circles             | Rings of images orbiting a center                         |
| `draggable-grid`      | Draggable Grid      | A grid you can drag around with smooth momentum           |
| `animated-list`       | Animated List       | A live feed where new items animate into the list         |
| `comparison-slider`   | Comparison Slider   | A before and after image slider                           |
| `hover-preview`       | Hover Preview       | Words that show an image preview on hover                 |
| `infinite-gallery`    | Infinite Gallery    | An endless field of images you drift through in 3D        |
| `parallax-carousel`   | Parallax Carousel   | A draggable image carousel with parallax                  |
| `circle-stack`        | Circle Stack        | A tilted stack of circles that cycles through your images |
| `lenticular-carousel` | Lenticular Carousel | A gallery whose cards turn over like a lenticular print   |
| `reel-gallery`        | Reel Gallery        | Tilted reels of images that glide as you scroll           |
| `skewed-carousel`     | Skewed Carousel     | A skewed carousel of cards that tilt as they slide        |
| `tilted-tiles`        | Tilted Tiles        | A tilted wall of image columns scrolling past             |
| `tumble-carousel`     | Tumble Carousel     | Cards that tumble end over end as the carousel advances   |
| `scroll-portal`       | Scroll Portal       | Scroll through frames nested one inside the next          |
| `inverted-dome`       | Inverted Dome       | A draggable image grid curved like the inside of a dome   |
| `bend-gallery`        | Bend Gallery        | A column of images that bends away as it scrolls          |
| `twisting-gallery`    | Twisting Gallery    | Images that twist and sway as they scroll past            |
| `dolly-gallery`       | Dolly Gallery       | Images stacked in depth that you fly through on scroll    |
| `tile-reveal`         | Tile Reveal         | Image tiles that fly in on scroll to reveal a headline    |

### Images & reveals (12)

| Slug              | Name            | Description                                                 |
| ----------------- | --------------- | ----------------------------------------------------------- |
| `shader-reveal`   | Shader Reveal   | A liquid cursor trail that reveals a second image           |
| `liquid-swap`     | Liquid Swap     | Images that swap through a liquid glass ball                |
| `pixelate-hover`  | Pixelate Hover  | An image that pixelates or sharpens under the cursor        |
| `pixel-reveal`    | Pixel Reveal    | An image that reveals itself through a sweep of pixels      |
| `magic-transform` | Magic Transform | Documents fly in and come out as colorful results           |
| `frame-scrub`     | Frame Scrub     | An image sequence that plays as you scroll                  |
| `particle-image`  | Particle Image  | An image of particles that swirl apart and reform           |
| `scroll-mask`     | Scroll Mask     | An image revealed through a mask as you scroll              |
| `particle-morph`  | Particle Morph  | A halftone dot matrix that morphs from one image into the next |
| `pixel-sculpt`    | Pixel Sculpt    | An image rebuilt as 3D tiles that ripple under the cursor   |
| `glass-reveal`    | Glass Reveal    | A glass lens that reveals one image through another         |
| `depth-image`     | Depth Image     | A photo relit with depth by a light that follows the cursor |

### Other / utility (5)

| Slug             | Name           | Description                                     |
| ---------------- | -------------- | ----------------------------------------------- |
| `globe`          | Globe          | A dotted 3D globe with animated arcs            |
| `device`         | Device         | A studio-lit 3D phone mockup that frames any image or content |
| `simple-graph`   | Simple Graph   | A smooth animated line graph                    |
| `preloader`      | Preloader      | Loading screens in five styles                  |
| `parallax-pills` | Parallax Pills | Bouncy labeled pills that drift with the cursor |

### Latest component additions (80)

These components use **named exports**, include Tailwind and vanilla-CSS variants, and
expose sizing, appearance and motion controls. Inspect the documented props before integrating.

#### Backgrounds, particles & ASCII (27)

| Slug | Name | Description |
| --- | --- | --- |
| `spectral-drape` | Spectral Drape | A glowing drape of dots folding in 3D |
| `horizon-bloom` | Horizon Bloom | A sunrise breaking over the glowing edge of a dark planet |
| `photon-knot` | Photon Knot | A translucent ribbon of light tied into a slowly turning knot |
| `axial-beam` | Axial Beam | Soft rays of light rising from beyond the frame |
| `nexus-rays` | Nexus Rays | Laser beams radiating from a glowing core |
| `hexagonal-vault` | Hexagonal Vault | A hexagon grid lit by a soft light that follows the cursor |
| `prismatic-slats` | Prismatic Slats | Colored liquid refracted through fluted glass |
| `luminous-filaments` | Luminous Filaments | Glowing fibers fanning out from a bright source |
| `interference-ribbons` | Interference Ribbons | A ribbon of fine glowing wires drifting and twisting |
| `voxel-arc` | Voxel Arc | A curved horizon of square voxels rolling like a calm sea |
| `chroma-current` | Chroma Current | Currents of light flowing across a grid of glowing dots |
| `cloud-atlas` | Cloud Atlas | Billowing clouds you can push around like wind |
| `satin-ridges` | Satin Ridges | Flowing satin folds catching soft highlights |
| `concentric-tides` | Concentric Tides | Fine glowing arcs pinching into a bright hourglass |
| `contour-tide` | Contour Tide | An ocean of particles rolling in waves |
| `spiral-funnel` | Spiral Funnel | Fine threads of light spiraling up a turning vortex |
| `astral-shell` | Astral Shell | A slowly turning globe of connected stars |
| `binary-orbits` | Binary Orbits | A tilted spiral galaxy of stars streaming through its arms |
| `glyph-tide` | Glyph Tide | An ASCII tide that floods and drains the shore |
| `terminal-rain` | Terminal Rain | Streams of glowing glyphs raining down in layered columns |
| `glyph-ember` | Glyph Ember | ASCII fire licking up from a white-hot bed of glyphs |
| `glyph-orb` | Glyph Orb | A banded ASCII planet turning slowly in the light of a distant sun |
| `glyph-sonar` | Glyph Sonar | Sonar pings sweeping a field of glyphs, lighting up drifting shoals |
| `dappled-light` | Dappled Light | Sunlight falling through swaying leaves onto a wall |
| `glimmer-wrap` | Glimmer Wrap | A field of fine glints drifting past, flashing as they catch the light |
| `fading-stars` | Fading Stars | Stars rising from beyond the frame on trails that fade behind them |
| `ring-field` | Ring Field | Wavy rings of fine dust drifting outward from a dark center |

#### Text & typography (20)

| Slug | Name | Description |
| --- | --- | --- |
| `elastic-lettering` | Elastic Lettering | A headline you can grab, stretch and fling like an elastic band |
| `signal-type` | Signal Type | A headline that flickers on like a neon sign |
| `spring-lettering` | Spring Lettering | Letters that lean after the cursor on springs |
| `smoke-type` | Smoke Type | A headline that condenses out of drifting smoke, letter by letter |
| `rising-ink` | Rising Ink | Letters that lift off the page in 3D near the cursor |
| `domino-lettering` | Domino Lettering | Letters that topple like dominoes and rebuild |
| `glyph-lottery` | Glyph Lottery | Letters that spin like slot reels and lock into a headline |
| `cipher-reveal` | Cipher Reveal | A headline that decodes out of scrambled characters |
| `luminous-type` | Luminous Type | A drifting spotlight that brings dimmed text into the light |
| `orbital-type` | Orbital Type | A turning globe wrapped in rings of text you can spin by hand |
| `gravity-letters` | Gravity Letters | A headline of glyph sand you can slice; cut pieces fall, shatter and pour back |
| `wave-lettering` | Wave Lettering | A sea of text lines rolling in soft swells, in and out of focus |
| `mesh-lettering` | Mesh Lettering | A headline cut from silk that ripples in a slow breeze and billows at your touch |
| `stipple-type` | Stipple Type | A marbled-ink headline that swirls and breaks into stipple as you stir it |
| `vapor-type` | Vapor Type | Words that condense out of vapor and drift away |
| `typographic-wall` | Typographic Wall | A wall of scrambling glyphs that decodes scattered words, line by line |
| `ribbon-type` | Ribbon Type | Text printed on satin ribbons that twist and wave through 3D space |
| `ghost-type` | Ghost Type | A headline that writes itself with AI-style ghost completions |
| `text-morph` | Text Morph | Words that morph letter by letter, with shared letters gliding into place |
| `shatter-type` | Shatter Type | A headline cut into glass shards that assemble, crack under the cursor and shatter on click |

#### Galleries & image effects (19)

| Slug | Name | Description |
| --- | --- | --- |
| `passage-gallery` | Passage Gallery | A tunnel of photos you glide through |
| `constellation-gallery` | Constellation Gallery | Photo cards that flow between rings, spirals and globes |
| `concave-carousel` | Concave Carousel | A gallery wall that curves around the viewer |
| `orbit-reel` | Orbit Reel | A turning wheel of cards that sweeps into an arc |
| `depth-ribbon` | Depth Ribbon | A ribbon of images winding through 3D space |
| `prism-carousel` | Prism Carousel | A coverflow that sweeps color into each new image |
| `iris-gallery` | Iris Gallery | An oval of photos that turns into an iris |
| `album-rail` | Album Rail | A fan of album sleeves, each with a record tucked inside |
| `expanding-grid` | Expanding Grid | A portrait grid that magnifies faces under the cursor |
| `contact-sheet` | Contact Sheet | Photos streaming out of the center, developing like prints |
| `elastic-reel` | Elastic Reel | A dock of photo slices that swell open into full images |
| `vertical-reel` | Momentum Ring | A ring of photos that blurs as it spins and clicks into place |
| `spin-shutter` | Spin Shutter | An orbit of photos that spins open and pulls focus where you point |
| `helix-gallery` | Helix Gallery | Photos spiraling out from a dense core |
| `tumble-wall` | Tumble Wall | A pile of photos, avatars or tags that rains in and can be thrown around |
| `loupe-image` | Loupe Image | A loupe that glides over a photo and magnifies its finest details |
| `ember-reveal` | Ember Reveal | A burning hole that reveals the next image |
| `pond-image` | Pond Image | A photo you can stir like liquid |
| `scroll-bend` | Scroll Bend | A strip of images that bulges or pinches with your scroll speed |

#### Cursors & interactions (14)

| Slug | Name | Description |
| --- | --- | --- |
| `chrome-orbit` | Chrome Orbit | Nested chrome rings that turn like a gyroscope and swing into a halo on click |
| `chroma-halo` | Chroma Halo | Soft ink that blooms behind the cursor |
| `drafting-cursor` | Drafting Cursor | Hairline crosshairs with edge rulers, a coordinate readout and drag-to-measure |
| `glyph-stream` | Glyph Stream | A liquid stream of glyph tiles that pours after the cursor and splashes on click |
| `ribbon-trail` | Ribbon Trail | A gymnast's ribbon that trails the cursor |
| `stardust-cursor` | Stardust Cursor | Fine dust carried on a fluid wake behind the cursor, with a mushroom puff on click |
| `pigment-trail` | Pigment Trail | An ink brush that paints behind the cursor |
| `arc-cursor` | Arc Cursor | A crackling electric arc that trails the cursor |
| `gyroscope-cursor` | Gyroscope Cursor | An arrow cursor that turns toward where it moves |
| `label-orbit` | Label Orbit | A label that becomes the cursor and trails a 3D stack |
| `tessera-trail` | Tessera Trail | A cursor trail of bouncy letter tiles |
| `celebration-cursor` | Celebration Cursor | Tumbling paper confetti that spills from the cursor and bursts on click |
| `snapshot-trail` | Snapshot Trail | A cursor trail of photos that lean, toss and settle like prints |
| `elastic-sticker` | Elastic Sticker | A sticker you can peel off the page and paste back |

---

## Appendix B: Marketing block catalog (`@reactbits-pro`, 300, **Pro tier**)

Install as `@reactbits-pro/<slug>` (no suffix). Slugs are sequential within each category starting at 1.
See [Marketing block import reference](#marketing-block-import-reference-verified) for the per-slug export style.

| Category       | Slug range                           | Count | What it covers                                        |
| -------------- | ------------------------------------ | ----- | ----------------------------------------------------- |
| Hero           | `hero-1` … `hero-34`                 | 34    | Heroes: split, centered, video, carousel and animated |
| Features       | `features-1` … `features-17`         | 17    | Feature grids, tabs, marquees, auto-cycling carousels |
| Social Proof   | `social-proof-1` … `social-proof-16` | 16    | Logos, testimonials, reviews, marquees, video         |
| Contact        | `contact-1` … `contact-12`           | 12    | Contact forms and split/card layouts                  |
| Footer         | `footer-1` … `footer-12`             | 12    | Footers with links, newsletter, branding              |
| Comparison     | `comparison-1` … `comparison-8`      | 8     | Feature/pricing comparison tables and charts          |
| Navigation     | `navigation-1` … `navigation-15`     | 15    | Top/side/bottom navs and mobile menus                 |
| Auth           | `auth-1` … `auth-6`                  | 6     | Sign-in / sign-up layouts                             |
| Call To Action | `cta-1` … `cta-14`                   | 14    | CTAs with parallax, cursor trails, video masks        |
| FAQ            | `faq-1` … `faq-9`                    | 9     | Accordion, chat-style, tabbed FAQs                    |
| Pricing        | `pricing-1` … `pricing-15`           | 15    | Pricing tables with toggles and comparisons           |
| Stats          | `stats-1` … `stats-18`               | 18    | Metrics with charts, maps, animations                 |
| 404            | `404-1` … `404-8`                    | 8     | Creative error pages                                  |
| Profile        | `profile-1` … `profile-6`            | 6     | User profile cards and sections                       |
| About          | `about-1` … `about-15`               | 15    | Story, timeline, team, metrics                        |
| Waitlist       | `waitlist-1` … `waitlist-6`          | 6     | Pre-launch signup sections                            |
| Showcase       | `showcase-1` … `showcase-8`          | 8     | Portfolio and product display                         |
| How It Works   | `how-it-works-1` … `how-it-works-9`  | 9     | Step-by-step process sections                         |
| Download       | `download-1` … `download-8`          | 8     | App/file download sections                            |
| Blog           | `blog-1` … `blog-11`                 | 11    | Blog listings and article layouts                     |
| Ecommerce      | `ecommerce-1` … `ecommerce-11`       | 11    | Product pages, catalogs, storefronts                  |
| Bento          | `bento-1` … `bento-42`               | 42    | Animated feature tiles for bento grids                |

**Bento tiles are grid cells, not sections.** A `bento-N` fills whatever cell it is given (`h-full`,
no viewport height, no page gutter). Place tiles inside a grid you own and put the column/row
spans on wrapper `div`s, never on the tile:

```tsx
<section className="w-full px-4 py-16 sm:px-6 lg:px-8">
  <div className="mx-auto grid w-full max-w-[1400px] grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 lg:auto-rows-[minmax(380px,auto)]">
    <div className="sm:col-span-2">
      <Bento2 />
    </div>
    <div className="lg:row-span-2">
      <Bento8 />
    </div>
    <Bento5 />
  </div>
</section>
```

The [Bento Builder](https://pro.reactbits.dev/docs/blocks/tools/bento-builder) provides 2, 3 or 4
desktop columns and six spans: 1x1, 2x1, 3x1, 1x2, 2x2 and 3x2. Wide spans clamp to the chosen
column count. Layouts adapt to one column on mobile and two on tablet.

- Drag tiles onto the canvas, resize from the edges, reposition them, and tidy gaps.
- Set an optional section heading and preview the responsive layout.
- Export the generated grid component and install command, or copy the agent prompt.
- Keep the generated responsive spans, row heights and placements when integrating the result.
  Install only the referenced tiles; `bento-grid` is generated code, not an installable registry slug.
- The [Landing Builder](https://pro.reactbits.dev/builder) also supports Bento grids as page sections,
  including editing, full-page preview and project export alongside ordinary marketing blocks.

Bento's mock interfaces are illustrations inside marketing tiles, not App UI blocks. Do not wrap
the grid in `.rb-theme-scope` or apply the App UI theme tokens. Global light/dark mode still applies.

---

## Appendix C: App UI block catalog (`@reactbits-pro`, 300, **Pro tier**)

Application-interface blocks for the signed-in product: shells, navigation, data,
forms, overlays, auth, and AI/agent surfaces. Install as `@reactbits-pro/<slug>`
(no suffix), exactly like a marketing block.

**All 300 are `export default`**: the one block family where you do not need to read the
export line first. Every root is `h-full min-h-[Npx]`, so give each one a
height-bounded parent. See [App UI blocks](#app-ui-blocks-pro-tier).

Slugs are sequential from `1` within each category.

### AI & Agents (49)

| Slug range                              | Count | What it covers                                                      |
| --------------------------------------- | ----- | ------------------------------------------------------------------- |
| `agent-activity-1` … `agent-activity-7` | 7     | Live agent run logs, step timelines and status streams              |
| `agent-approval-1` … `agent-approval-6` | 6     | Human-in-the-loop approval gates for agent actions                  |
| `agent-plan-1` … `agent-plan-6`         | 6     | Multi-step agent plans with progress and revision                   |
| `ai-chat-1` … `ai-chat-9`               | 9     | Conversation surfaces with streaming, citations and message actions |
| `ai-usage-1` … `ai-usage-8`             | 8     | Token, cost and quota reporting                                     |
| `prompt-input-1` … `prompt-input-7`     | 7     | Composer inputs with attachments, model pickers and slash commands  |
| `tool-calls-1` … `tool-calls-6`         | 6     | Tool invocation cards with arguments, results and errors            |

### Navigation (41)

| Slug range                          | Count | What it covers                                              |
| ----------------------------------- | ----- | ----------------------------------------------------------- |
| `app-shell-1` … `app-shell-9`       | 9     | Full application frames: sidebar, topbar and content region |
| `app-sidebar-1` … `app-sidebar-7`   | 7     | Standalone sidebars with nav trees, workspaces and collapse |
| `command-menu-1` … `command-menu-6` | 6     | Command palettes and keyboard-driven launchers              |
| `mobile-1` … `mobile-5`             | 5     | Mobile app chrome: tab bars, sheets and headers             |
| `navbar-1` … `navbar-14`            | 14    | Application top bars with search, actions and account menus |

### Data (89)

| Slug range                          | Count | What it covers                                  |
| ----------------------------------- | ----- | ----------------------------------------------- |
| `analytics-1` … `analytics-16`      | 16    | Charts, funnels, cohorts and reporting surfaces |
| `card-1` … `card-11`                | 11    | Metric, entity and summary cards                |
| `dashboard-1` … `dashboard-14`      | 14    | Composed dashboard screens                      |
| `data-table-1` … `data-table-8`     | 8     | Sortable, selectable and paginated tables       |
| `empty-state-1` … `empty-state-5`   | 5     | First-run, no-results and error placeholders    |
| `file-manager-1` … `file-manager-4` | 4     | File browsers, uploads and asset grids          |
| `filtering-1` … `filtering-9`       | 9     | Filter bars, facet panels and saved views       |
| `list-1` … `list-12`                | 12    | Dense record lists, inboxes and feeds           |
| `monitoring-1` … `monitoring-10`    | 10    | Status boards, incidents, logs and health       |

### Forms (18)

| Slug range                            | Count | What it covers                                    |
| ------------------------------------- | ----- | ------------------------------------------------- |
| `forms-1` … `forms-12`                | 12    | General multi-field forms with validation layouts |
| `settings-form-1` … `settings-form-6` | 6     | Account, workspace and preference forms           |

### Overlays (13)

| Slug range                            | Count | What it covers                            |
| ------------------------------------- | ----- | ----------------------------------------- |
| `app-dialog-1` … `app-dialog-7`       | 7     | Modals, confirmations, sheets and drawers |
| `notifications-1` … `notifications-6` | 6     | Toasts, notification centers and inboxes  |

### Auth & Onboarding (28)

| Slug range                               | Count | What it covers                              |
| ---------------------------------------- | ----- | ------------------------------------------- |
| `authentication-1` … `authentication-14` | 14    | Sign in, sign up, MFA and recovery screens  |
| `onboarding-1` … `onboarding-7`          | 7     | Welcome flows, checklists and product tours |
| `paywall-1` … `paywall-7`                | 7     | Upgrade prompts, plan gates and trial walls |

### Workflows (62)

| Slug range                          | Count | What it covers                                       |
| ----------------------------------- | ----- | ---------------------------------------------------- |
| `billing-1` … `billing-8`           | 8     | Plans, invoices, payment methods and usage           |
| `chat-1` … `chat-6`                 | 6     | Team and support messaging (non-AI)                  |
| `comments-1` … `comments-6`         | 6     | Threads, mentions and activity discussion            |
| `editor-1` … `editor-5`             | 5     | Rich text and document editing surfaces              |
| `feedback-1` … `feedback-6`         | 6     | Surveys, ratings, NPS and feature requests           |
| `integrations-1` … `integrations-6` | 6     | Connection directories, API keys and webhooks        |
| `kanban-1` … `kanban-6`             | 6     | Board views with columns, cards and drag affordances |
| `scheduling-1` … `scheduling-7`     | 7     | Calendars, availability and booking                  |
| `support-1` … `support-5`           | 5     | Help centers, ticketing and contact surfaces         |
| `wizard-1` … `wizard-7`             | 7     | Multi-step flows with progress and validation        |

Browse them at https://pro.reactbits.dev/docs/app-ui

---

## Quick reference

- **Install component** _(Starter+)_: `npx shadcn@latest add @reactbits-starter/<slug>-tw` (or `-css`)
- **Install marketing block** _(Pro+)_: `npx shadcn@latest add @reactbits-pro/<slug>`
- **Install App UI block** _(Pro+)_: `npx shadcn@latest add @reactbits-pro/<slug>`
- **Install Agent Kit item** _(Pro+)_: `npx shadcn@latest add @reactbits-pro/{skill,prompt,recipe}-<slug>`
- **Install this skill** _(Starter+)_: `npx shadcn@latest add @reactbits-starter/skill`
- **Component import:** read the export; use `import { ComponentName }` for named exports and `import AnyName` for default exports.
- **App UI block import:** `import AnyName from "@/components/blocks/<slug>"` (always default)
- **Marketing block import:** open the file → `export default` ⇒ default import · `export function X` ⇒ `import { X }`
- **Reveal a marketing block's export:** `grep -E "^export (default )?function " components/blocks/<slug>.tsx`
- **App UI needs a bounded height:** wrap in `h-dvh`, `h-screen` or a fixed `h-[Npx]`
- **Tiers:** Starter = 230 components + setup skill · **Pro = + 300 marketing blocks, + 300 App UI blocks, + the complete 20-item Agent Kit** · Ultimate = + 15 template downloads
- **Free without any license:** `@reactbits-pro/skill-terminal-dark`
- **Live catalogs:** https://pro.reactbits.dev/docs/components · /docs/blocks · /docs/app-ui · /docs/agent-kit · /docs/templates
