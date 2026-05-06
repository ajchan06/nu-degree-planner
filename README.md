# NU Degree Planner

> 🚧 This project is actively under development. New features are being added regularly.

An automated degree planning tool for Northeastern University students. Enter your completed courses, AP credits, major, and concentration — get a personalized semester-by-semester degree plan generated automatically.

## Features

- Generates a complete 4-year degree plan based on your completed coursework
- Accounts for co-op semesters, prerequisites, and corequisites
- Satisfies all 13 NUpath requirements automatically
- Supports all 4 Khoury College majors (BSCS, BSDS, BSCY, BACS) with concentrations
- Handles AP credits and transfer credits
- Respects credit hour limits and difficulty ramping

## Tech Stack

**Backend:** Node.js, Express, Supabase (PostgreSQL)

**Frontend:** React, Vite, Tailwind CSS

**Database:** 11-table PostgreSQL schema with 178+ courses, prerequisites, corequisites, NUpath mappings, and concentration requirements

## Getting Started

Clone the repo and install dependencies for both backend and frontend.

    # Backend
    cd backend
    npm install
    npm run dev

    # Frontend (in a separate terminal)
    cd frontend
    npm install
    npm run dev

Backend runs on http://localhost:3000

Frontend runs on http://localhost:5173

## Project Structure

    nu-degree-planner/
    ├── backend/
    │   ├── generator/
    │   │   └── planner.js      # Auto-generator algorithm
    │   ├── routes/
    │   │   ├── students.js
    │   │   ├── courses.js
    │   │   └── majors.js
    │   └── server.js
    └── frontend/
        └── src/
            ├── pages/
            │   ├── Onboarding.jsx
            │   └── Plan.jsx
            └── App.jsx

## Roadmap

- [x] PostgreSQL database schema with 178+ courses
- [x] Prerequisite and corequisite handling
- [x] NUpath requirement satisfaction
- [x] Co-op semester scheduling
- [x] AP credit and transfer credit support
- [x] React onboarding flow
- [x] Semester plan view
- [ ] Course swap and customization
- [ ] Multi-major and double concentration support
- [ ] Advisor sharing and export to PDF
- [ ] Mobile responsive design
- [ ] Supabase authentication

## Author

Built by Anthony Chan — Northeastern University, Computer Science
