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

- React
- JavaScript / JSX
- CSS
- React Icons

## Backend / Platform

- Supabase
- PostgreSQL
- Supabase Authentication
- Supabase Storage

## Planned Technologies

- AI/LLM integration
- Payment gateway
- QR generation and scanning
- Push notifications
- Admin dashboard
- Vendor dashboards
- Analytics

---

# 📁 Project Structure

The intended project structure is:

```text
campus-os/
│
├── public/
│   ├── favicon.ico
│   └── assets/
│
├── src/
│   │
│   ├── components/
│   │   ├── Navbar.jsx
│   │   ├── BottomNav.jsx
│   │   ├── Post.jsx
│   │   ├── EventCard.jsx
│   │   ├── ServiceCard.jsx
│   │   └── ...
│   │
│   ├── pages/
│   │   ├── Home.jsx
│   │   ├── Campus.jsx
│   │   ├── Events.jsx
│   │   ├── Services.jsx
│   │   └── Profile.jsx
│   │
│   ├── services/
│   │   ├── supabase.js
│   │   ├── posts.js
│   │   ├── events.js
│   │   └── services.js
│   │
│   ├── App.jsx
│   ├── index.css
│   └── main.jsx
│
├── .env.local
├── package.json
├── README.md
└── .gitignore
```

The current prototype may still contain several components inside `App.jsx`. As development progresses, these should be separated into reusable components.

---

# 🚀 Getting Started

## Prerequisites

Install:

- Node.js
- npm
- Git

Check your versions:

```bash
node --version
npm --version
```

---

## 1. Clone the Repository

```bash
git clone <YOUR_REPOSITORY_URL>
cd campus-os
```

---

## 2. Install Dependencies

```bash
npm install
```

Install React Icons:

```bash
npm install react-icons
```

Install Supabase:

```bash
npm install @supabase/supabase-js
```

---

# 🔐 Environment Variables

Create a file named:

```text
.env.local
```

Add:

```env
VITE_SUPABASE_URL=https://YOUR_PROJECT_ID.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=YOUR_SUPABASE_PUBLISHABLE_KEY
```

Never commit `.env.local` to Git.

Add it to `.gitignore`:

```gitignore
.env
.env.local
.env.*.local
```

> **Important:** Never expose a Supabase service-role/secret key in the frontend.

---

# 🗄️ Database

Campus OS uses PostgreSQL through Supabase.

The core database structure is:

```text
profiles
│
├── posts
│   ├── post_likes
│   └── comments
│
├── events
│   └── event_registrations
│
├── services
│   └── service_requests
│
├── help_requests
│
└── notifications
```

## Main Tables

| Table | Purpose |
|---|---|
| `profiles` | Student identity and profile |
| `posts` | Campus community posts |
| `post_likes` | Post reactions |
| `comments` | Post comments |
| `events` | Campus events |
| `event_registrations` | Event registrations |
| `services` | Available campus services |
| `service_requests` | Student service requests |
| `help_requests` | Student help requests |
| `notifications` | User notifications |

---

# 🔒 Security

Campus OS uses Row Level Security (RLS) to protect user data.

Example permissions:

```text
Student
   │
   ├── Can read public campus posts
   │
   ├── Can create own posts
   │
   ├── Can edit own profile
   │
   ├── Can delete own posts
   │
   ├── Can register for events
   │
   └── Can view own service requests
```

Administrative permissions should be separated from normal student permissions.

---

# 🔑 Authentication

The current prototype contains a demo login experience.

The production authentication flow is intended to be:

```text
Student
   ↓
College Email
   ↓
Authentication
   ↓
Verified Campus Account
   ↓
Campus Profile
```

For production deployment, authentication should be restricted to approved institutional email domains or another institution-approved identity mechanism.

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

Payments are planned for:

- Food orders
- Printing
- Stationery
- Event registrations
- Campus merchandise
- Other paid campus services

The architecture should support marketplace-style vendor settlements rather than treating all vendor revenue as platform revenue.

Payment integration will be implemented after the core authentication and database system is stable.

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

**Status: Active MVP / Prototype**

The current interface demonstrates the intended Campus OS experience.

The next development stage is connecting the existing UI to Supabase so that the application becomes persistent and multi-user.

### Currently being integrated

- [ ] Supabase authentication
- [ ] PostgreSQL database
- [ ] Persistent community posts
- [ ] Event registration
- [ ] User profiles
- [ ] Service requests
- [ ] Notifications

### Not yet production-ready

- [ ] Payment processing
- [ ] Vendor settlements
- [ ] Production authentication policies
- [ ] Admin permissions
- [ ] Moderation system
- [ ] Production AI
- [ ] Multi-campus deployment

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
