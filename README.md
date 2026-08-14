# Campus OS

> **The digital operating system for campus life.**

Campus OS is a unified campus platform designed to bring **students, clubs, events, campus services, vendors, opportunities, and administration** into a single digital ecosystem.

Instead of forcing students to switch between WhatsApp, Instagram, Google Forms, physical queues, separate service systems, and multiple campus portals, Campus OS provides one verified platform for discovering, communicating, collaborating, and accessing campus services.

---

## ✨ What Campus OS Does

Campus OS combines several campus experiences into one platform.

### 🏠 Campus Pulse

A real-time overview of what's happening across campus.

- Events happening today
- Hackathons
- Club activities
- Student achievements
- Help requests
- Lost & Found
- Campus announcements

---

### 📢 Campus Community

A structured campus-wide social feed where students can:

- Create posts
- Ask for help
- Share announcements
- Find teammates
- Share achievements
- Report lost items
- Discover student activities

---

### 🎉 Clubs & Events

Verified campus clubs can create their own digital spaces and manage:

- Events
- Announcements
- Registrations
- Workshops
- Competitions
- Club activities
- Student participation

---

### 💻 Hackathons & Team Formation

Students can publish the skills they have and the skills they need.

Example:

```text
Smart India Hackathon

Looking for:
✓ Flutter Developer
✓ UI/UX Designer

Already have:
✓ Machine Learning
✓ Backend

              [JOIN TEAM]
```

The long-term goal is intelligent student/team matching based on skills and interests.

---

### 🤝 Student Help Network

Students can request help from other students:

- Academic help
- Technical assistance
- Project collaboration
- Finding teammates
- Borrowing items
- Campus-related questions

---

### 🖨️ Print & Document Services

Digitize the campus printing experience:

```text
Upload Document
       ↓
Select Printing Options
       ↓
Place Order
       ↓
Payment
       ↓
QR Pickup
```

The goal is to eliminate unnecessary queues and allow students to submit print orders remotely.

---

### 📚 Campus Store

A digital marketplace for campus stationery and academic supplies.

Potential products include:

- Books
- Lab records
- Pens
- Files
- Calculators
- Chart paper
- Academic supplies

---

### 🗺️ Smart Campus Map

Students can search for:

- Classrooms
- Laboratories
- Departments
- Offices
- Seminar halls
- Printing facilities
- Campus services

Future versions can support accessibility-aware navigation.

---

### 🛠️ Campus Issue Reporting

Students can report:

- Wi-Fi problems
- Electrical issues
- AC problems
- Broken furniture
- Equipment failures
- Cleaning issues

Issues can follow a structured workflow:

```text
Reported
   ↓
Assigned
   ↓
In Progress
   ↓
Resolved
```

---

### 🏢 Resource Booking

Students and clubs can eventually book:

- Seminar halls
- Labs
- Meeting rooms
- Sports facilities
- Projectors
- Cameras
- Microphones
- Other shared resources

---

### 🔍 Lost & Found

Students can report lost or found items.

Future versions can use image and description matching to identify potential matches.

---

### 🛒 Campus Marketplace

A verified student marketplace for permitted campus transactions such as:

- Textbooks
- Calculators
- Electronics
- Cycles
- Academic equipment
- Furniture

---

### 👤 Digital Campus Identity

Every student can have a campus profile containing:

```text
Student
│
├── Skills
├── Projects
├── Hackathons
├── Clubs
├── Events
├── Achievements
└── Campus Activity
```

This creates a campus-specific identity and portfolio.

---

### 🤖 Campus AI

The long-term intelligence layer of Campus OS.

Students can ask questions such as:

> "Where is Lab 204?"

> "What events are happening tomorrow?"

> "Who is looking for a Flutter developer?"

> "How do I book the seminar hall?"

> "Where can I print my project report?"

The goal is for the AI to not only answer questions, but also **connect students to people, services and actions**.

---

# 🧠 Core Concept

Campus OS is built around three primary actions:

```text
                 CAMPUS OS
                     │
        ┌────────────┼────────────┐
        ↓            ↓            ↓
      CONNECT      DISCOVER      SOLVE
        │            │            │
        ↓            ↓            ↓
     Students      Events       Services
     Clubs         Hackathons   Printing
     Communities   Workshops    Booking
     Teams         Opportunities Issues
```

The platform connects these interactions through a common campus identity and data layer.

---

# 🏗️ Architecture

```text
                       ┌──────────────────────┐
                       │      CAMPUS OS       │
                       │     React Frontend   │
                       └──────────┬───────────┘
                                  │
                                  ↓
                       ┌──────────────────────┐
                       │   Supabase Client    │
                       └──────────┬───────────┘
                                  │
              ┌───────────────────┼───────────────────┐
              ↓                   ↓                   ↓
        ┌───────────┐       ┌────────────┐      ┌───────────┐
        │   Auth    │       │ PostgreSQL │      │  Storage  │
        └───────────┘       └────────────┘      └───────────┘
                                  │
             ┌────────────────────┼────────────────────┐
             ↓                    ↓                    ↓
          Profiles             Posts                 Events
             │                    │                    │
             ↓                    ↓                    ↓
          Students             Likes              Registrations
                                  │
                                  ↓
                              Comments

                                  │
                                  ↓
                         ┌─────────────────┐
                         │   Campus AI     │
                         │   Future Layer  │
                         └─────────────────┘
```

---

# 🛠️ Technology Stack

## Frontend

- React 18
- TypeScript (incremental adoption — new/rewritten files are `.ts`/`.tsx`, legacy files stay `.jsx`, see `tsconfig.json`)
- Vite (dev server + production build)
- TanStack Query
- Zod
- React Icons
- Tailwind CSS

## Backend / Platform

- Supabase (Auth, PostgreSQL, Storage, Realtime, Edge Functions)
- PostgreSQL with Row Level Security on every table
- Razorpay (test mode) for payments, via Edge Functions

## Testing / CI

- Jest + Testing Library (unit/component)
- Playwright (E2E, network-mocked — see `tests/helpers/mockSupabase.js`)
- GitHub Actions (`.github/workflows/ci.yml`): lint → typecheck → unit tests → build → E2E

---

# 📁 Project Structure

```text
CampusOS/
│
├── index.html                  # Vite entry point
├── src/
│   ├── main.jsx                 # React root + TanStack Query provider
│   ├── App.jsx                  # Main application shell + most page components
│   ├── features/
│   │   └── payments/             # Razorpay Checkout.js wrapper
│   ├── components/ui/            # Shared loading/empty/error/offline states
│   ├── services/mvpService.js    # Data layer — calls Postgres RPCs for anything
│   │                              # security-sensitive, direct reads for public data
│   ├── lib/supabase.ts           # Supabase client
│   ├── types/database.ts         # Hand-authored DB types (see file header)
│   ├── hooks/                    # useAuth, useOnlineStatus
│   └── utils/                    # orderCalculator, mvpHelpers
│
├── supabase/
│   ├── migrations/                # THE canonical schema — see its own README.md
│   └── functions/                 # Edge Functions (Razorpay order + webhook)
│
├── src/supabase/archive/          # Superseded schema files — do not run, kept for history
│
├── tests/                         # Playwright E2E specs + mock harness
├── src/__tests__/, src/**/*.test.js  # Jest unit tests
│
└── .github/workflows/ci.yml
```

`App.jsx` is still a large file holding most page-level components. The
service/data layer (the part that actually mattered for security and
correctness) was fully migrated off direct table writes onto Postgres RPCs
in this hardening pass; splitting the remaining UI into
`src/features/<name>/components/` is tracked in `docs/ROADMAP.md`.

---

# 🚀 Getting Started

## Prerequisites

- Node.js 20+
- npm
- Git
- (optional, for applying migrations/deploying functions) [Supabase CLI](https://supabase.com/docs/guides/cli)

```bash
node --version
npm --version
```

---

## 1. Clone the Repository

```bash
git clone <YOUR_REPOSITORY_URL>
cd CampusOS
```

## 2. Install Dependencies

```bash
npm install
```

## 3. Environment Variables

```bash
cp .env.example .env
```

Fill in your Supabase project's URL and **anon/publishable key** (Project
Settings → API). This key is safe to expose in client code — Row Level
Security, not key secrecy, is what protects the data behind it. Never put a
`service_role` key here.

## 4. Apply the database schema

The app needs the schema in `supabase/migrations/` applied to your Supabase
project before it'll work — see `supabase/migrations/README.md` for the two
supported ways to do that (Supabase CLI, or paste-into-SQL-Editor).

## 5. Run it

```bash
npm run dev        # Vite dev server, http://localhost:5173
npm run build       # production build -> dist/
npm run preview     # serve the production build locally
npm run lint         # ESLint
npm run typecheck    # tsc --noEmit
npm test              # Jest unit/component tests
npm run test:ui        # Playwright E2E (network-mocked, no live backend needed)
```

Signing in locally uses the same magic-link flow real students use — there
is no dev-login bypass shipped in the app (see `SECURITY.md` for why that
used to exist and was removed). E2E tests mock the backend instead, in
`tests/helpers/mockSupabase.js`.

---

# 🗄️ Database

Campus OS uses PostgreSQL through Supabase. The schema is fully described in
`supabase/migrations/` (14+ ordered, idempotent migration files) — see that
folder's own `README.md` for the complete table list, the RPC-based write
model, and what changed from the original prototype schema.

At a glance, writes to anything security- or money-sensitive (orders,
payments, refunds, event registrations, bookings, pickup redemption) go
through `SECURITY DEFINER` Postgres functions, never raw table inserts from
the browser — see `docs/DEPLOYMENT.md` for the full list of RPCs.

---

# 🔒 Security

Every table has Row Level Security enabled with real `auth.uid()`-scoped
policies — not the previous `for all to anon, authenticated using (true)`
open policies (see `SECURITY.md` for what that meant and why it was
replaced). A real RBAC layer (`roles`/`permissions`/`role_permissions`/
`user_roles`) backs every privileged policy and RPC, instead of ad-hoc
`role === 'vendor'` string checks.

**Before this goes anywhere near a real production campus**, read
`SECURITY.md` — it documents two real secrets found in this repo's git
history that need to be rotated.

---

# 🔑 Authentication

```text
Student
   ↓
College email (magic link)
   ↓
Supabase Auth session
   ↓
profiles row (auto-created via trigger)
   ↓
Campus assignment
```

The login modal restricts sign-in to a small allowlist of email domains
(`@nhce.edu.in`, `@newhorizonindia.edu`, `@gmail.com` for now — tighten this
to just the institutional domain before a real launch). `student_verifications`
exists in the schema for a stronger USN/document-based verification flow
(doc §7) but isn't wired into the UI yet — tracked in `docs/ROADMAP.md`.

---

# 🏪 Vendor System

Campus OS can support verified campus vendors.

For the target campus:

```text
Campus OS
     │
     ├── Canteen 1
     ├── Canteen 2
     ├── Canteen 3
     ├── Canteen 4
     ├── Print Shop
     └── Stationery Store
```

Each vendor can eventually receive a dedicated dashboard.

```text
Vendor Dashboard

New Orders
Pending Orders
Completed Orders
Revenue
Products
Inventory
```

---

# 💳 Payments

Food orders are wired to **Razorpay in test mode**: `create_food_order()` computes the authoritative total server-side, `create-razorpay-order` (Edge Function) opens a gateway order, and `razorpay-webhook` (Edge Function) is the only thing that ever flips `orders.payment_status` to `paid` — after verifying the gateway's HMAC signature server-side. See `supabase/functions/README.md` for how to get free Razorpay test keys and deploy the functions.

A full payment ledger (`payments`, `payment_events`, `refunds`) and refund flow (full/partial, vendor-initiated) exist in the schema. Printing/store/event-registration payments and vendor payout settlement are not wired up yet — tracked in `docs/ROADMAP.md`.

---

# 📊 Admin Dashboard

A dedicated administration interface is planned.

Administrators will eventually be able to monitor:

```text
Students
Clubs
Events
Posts
Reports
Service Requests
Bookings
Vendors
Transactions
Analytics
```

Example:

```text
CAMPUS OVERVIEW

Students                 8,024
Active Students          5,842

Events This Month          126
Active Clubs                42

Open Issues                 31
Resolved Issues             214

Print Orders              2,418
Service Requests          1,284
```

---

# 🤖 Campus AI Roadmap

## Campus Search

```text
"Where is Lab 204?"
```

## Event Discovery

```text
"What events are happening tomorrow?"
```

## Team Matching

```text
"Find me a team that needs a React developer."
```

## Service Discovery

```text
"Where can I print my project?"
```

## Personalized Recommendations

```text
Based on your skills:

→ 3 hackathons
→ 2 clubs
→ 4 workshops
→ 5 potential teammates
```

---

# 📈 Scalability

The initial target is approximately:

**8,000 students**

The architecture is designed to eventually support multiple institutions:

```text
College 1
   ↓
8,000 students

College 2
   ↓
12,000 students

College 3
   ↓
20,000 students

        ↓

Multi-campus platform
```

The long-term goal is to make Campus OS configurable for different colleges and institutions.

---

# 🗺️ Development Roadmap

## Phase 1 — Prototype

- [x] Campus UI
- [x] Campus Pulse
- [x] Community feed
- [x] Events
- [x] Services
- [x] Student profile
- [x] Light/dark mode
- [x] React-based icons

---

## Phase 2 — Functional MVP

- [ ] Supabase connection
- [ ] Authentication
- [ ] Student profiles
- [ ] Persistent posts
- [ ] Comments
- [ ] Likes
- [ ] Event registration
- [ ] Notifications

---

## Phase 3 — Campus Services

- [ ] Print ordering
- [ ] Stationery store
- [ ] Service requests
- [ ] Lost & Found
- [ ] Resource booking
- [ ] Campus map

---

## Phase 4 — Commerce

- [ ] Four-canteen integration
- [ ] Vendor dashboards
- [ ] Product management
- [ ] Orders
- [ ] Payments
- [ ] QR pickup
- [ ] Transaction tracking

---

## Phase 5 — Intelligence

- [ ] Campus AI
- [ ] Semantic campus search
- [ ] Student/team matching
- [ ] Personalized recommendations
- [ ] AI-powered Lost & Found matching

---

## Phase 6 — Institutional Platform

- [ ] Admin dashboard
- [ ] Analytics
- [ ] Moderation
- [ ] Club management
- [ ] Vendor management
- [ ] Multi-campus support

---

# 💰 Monetization Strategy

Campus OS is designed to keep the core student experience accessible while monetizing the ecosystem around it.

Potential revenue sources include:

### Transaction Revenue

Small margins on:

- Printing
- Stationery
- Campus services
- Food ordering

### Vendor Commission

A small commission from participating campus vendors.

### Sponsored Promotions

Businesses can promote:

- Workshops
- Products
- Events
- Student offers
- Recruitment campaigns

### Event Sponsorship

Companies can sponsor:

- Hackathons
- Workshops
- Competitions
- Technical events

### Recruitment

Companies can access student talent through:

- Internship listings
- Hiring challenges
- Hackathons
- Skill discovery

### Institutional SaaS

Long term, colleges can subscribe to Campus OS as a complete campus platform.

---

# 🔄 Campus OS Flywheel

```text
More Students
      ↓
More Community Activity
      ↓
More Events & Opportunities
      ↓
More Services Used
      ↓
More Vendors Participate
      ↓
More Transactions
      ↓
More Revenue
      ↓
Better Platform
      ↓
More Students
```

---

# 🎨 UI / UX

Campus OS uses a modern application interface focused on:

- Clean cards
- Responsive layouts
- Mobile-first navigation
- React SVG icons
- Light mode
- Dark mode
- Persistent theme preference
- Campus-focused information hierarchy

---

# 📱 Target Platform

The initial application is designed as a responsive web application.

Future versions can be packaged as:

- Android application
- iOS application
- Progressive Web App
- Campus kiosk interface

---

# ⚠️ Current Project Status

**Status: Hardened MVP — student-facing modules are production-grade at the data layer; not yet deployed live.**

A production-hardening pass (see `docs/ROADMAP.md` for the full writeup)
took the original MVP prototype and:

### Done in this pass

- [x] Real RLS on every table (the old schema granted world-write access — see `SECURITY.md`)
- [x] RBAC (roles/permissions) backing every privileged action
- [x] Server-enforced order/ticket/booking state machines, idempotent order creation
- [x] Payments wired to Razorpay test mode, webhook-verified, never trusted from the browser
- [x] Secure single-use pickup tokens (food orders)
- [x] Removed a hardcoded dev-login backdoor
- [x] Parcel → Vite + incremental TypeScript
- [x] Cursor pagination on posts/orders/notifications/marketplace/events/people
- [x] Database-level rate limiting on orders/bookings/posts/comments/listings/etc.
- [x] Loading/empty/error/offline states on the highest-traffic screens
- [x] CI (lint/typecheck/test/build/E2E), including a network-mocked critical order-flow E2E test

### Deliberately not done in this pass (see `docs/ROADMAP.md`)

- [ ] Live deployment (Vercel/Cloudflare + a real domain)
- [ ] Vendor/facilities/admin dashboards (the schema and RPCs are ready; no UI yet)
- [ ] Messaging, AI assistant, IoT/delivery robots, multi-app split
- [ ] Full UI componentization of `App.jsx` into `src/features/*/components`

---

# 🤝 Contributing

Contributions are welcome.

Create a feature branch:

```bash
git checkout -b feature/your-feature
```

Make your changes, then:

```bash
git add .
git commit -m "feat: add your feature"
git push origin feature/your-feature
```

Open a pull request containing:

- What was changed
- Why it was changed
- Screenshots if UI was modified
- Testing performed

---

# 📄 License

Choose an appropriate license before making the repository public.

For an initial college deployment, the repository can remain private.

---

# 🎯 Vision

Campus OS is not intended to be another isolated college application.

The long-term vision is:

> **A single digital ecosystem through which students discover opportunities, communicate with their community, access campus services, build their identity, and interact with their institution.**

```text
                    CAMPUS
                       │
                       ↓
                  CAMPUS OS
                       │
        ┌──────────────┼──────────────┐
        ↓              ↓              ↓
      PEOPLE        SERVICES     OPPORTUNITIES
        │              │              │
      Clubs          Print          Hackathons
      Students       Store          Events
      Teams          Booking        Workshops
      Community      Issues         Careers
        │              │              │
        └──────────────┼──────────────┘
                       ↓
                  CAMPUS AI
```

---

# 🚀 Campus OS

### One campus.

### One platform.

### One connected student experience.
