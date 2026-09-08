# SmartFlow Scheduler

SmartFlow Scheduler is a modern intelligent productivity app designed to help users plan their day, manage tasks, track focus sessions, and automatically reschedule unfinished work. Instead of simply marking an incomplete task as missed, SmartFlow calculates the remaining time and intelligently moves the unfinished portion into the next suitable available time slot while considering working hours, existing tasks, priorities, deadlines, and scheduling conflicts.

## ✨ Features

* **Smart Auto-Rescheduling** — Automatically carries unfinished tasks forward into the next available time slot.
* **Partial Task Completion** — Record how much of a task was completed and automatically schedule the remaining duration.
* **Priority-Based Planning** — Tasks can be categorized as High, Medium, or Low priority.
* **Deadline Awareness** — Scheduling considers task deadlines when searching for future availability.
* **Conflict Detection** — Detects overlapping tasks before scheduling or editing.
* **Plan My Day** — Automatically organizes unscheduled/backlog tasks into available time slots based on priority and urgency.
* **Focus Mode** — Built-in focus timer for dedicated work sessions.
* **Calendar Views** — Organize tasks across your schedule and visualize upcoming work.
* **Recurring Tasks** — Supports daily, weekday, and weekly recurring tasks.
* **Task History** — Keeps track of task progress and rescheduling events.
* **Fixed Appointments** — Fixed tasks can block time and are respected by the scheduling engine.
* **Progress Tracking** — Visualize daily completion and productivity insights.
* **Dark / Light Theme** — Modern responsive interface with a polished productivity-focused design.
* **Firebase Integration** — Authentication and cloud persistence are included in the TSX implementation.
* **Gemini Integration** — The TSX implementation includes a Gemini API integration layer for AI-powered functionality.

## 🧠 How Smart Rescheduling Works

The core scheduling engine searches the user's working hours for free time windows while respecting existing blocking tasks. When a task is partially completed, SmartFlow calculates the remaining duration and searches forward day-by-day for a suitable slot.

For example:

> **Task:** Prepare Project Report
> **Planned:** 120 minutes
> **Completed:** 45 minutes
> **Remaining:** 75 minutes

Instead of losing the unfinished work, SmartFlow creates a carry-over task containing the remaining 75 minutes and automatically places it in the next suitable available slot.

The scheduling engine can search up to 21 days ahead and can also respect an optional deadline.

## 🔄 Scheduling Logic

The scheduling system follows this general flow:

1. Read the task's planned duration.
2. Calculate the amount of time already completed.
3. Calculate the remaining duration.
4. Inspect the current day's available working-hour windows.
5. Ignore time occupied by blocking tasks.
6. Search future days if today's schedule cannot accommodate the remaining work.
7. Respect the task deadline when one exists.
8. Create a carry-over task when unfinished work remains.
9. Mark the carry-over task as scheduled or unscheduled depending on availability.
10. Preserve the relationship between the original task and its carried-forward task.

This logic is implemented through functions such as `getFreeSlots()`, `findSlotForDuration()`, `resolveTaskProgress()`, and `planMyDay()` in the SmartFlow scheduler implementation.

## 🏗️ Project Files

```text
SmartFlow-Scheduler/
│
├── smartflow_scheduler.tsx
├── SmartFlowScheduler.jsx
├── README.md
│
└── ...
```

### `smartflow_scheduler.tsx`

This version contains the SmartFlow application with Firebase authentication, Firestore data synchronization, and Gemini API integration. Firebase is used for user authentication and persistent task/settings data.

### `SmartFlowScheduler.jsx`

This version focuses on the complete SmartFlow scheduling experience, including the scheduling engine, task management, focus timer, recurring tasks, calendar functionality, insights, and intelligent carry-over scheduling.

## 🎨 User Experience

SmartFlow uses a modern productivity-oriented interface with:

* Glassmorphism-style cards
* Dark and light themes
* Gradient accents
* Animated progress indicators
* Timeline-based task visualization
* Floating navigation
* Focus-mode interface
* Visual priority and status indicators
* Responsive mobile-first layout

The application includes a dark visual system with animated background effects and a floating bottom navigation experience.

## 🛠️ Technologies

* React
* JavaScript / JSX
* TypeScript / TSX
* Firebase Authentication
* Firebase Firestore
* Google Gemini API
* Recharts
* Lucide React
* Modern CSS / utility-style classes
* Browser-based date and time scheduling logic

## 🚀 Project Goal

The goal of SmartFlow is to create a productivity system that behaves more like an intelligent personal scheduler than a traditional to-do list.

Traditional task managers often treat an unfinished task as a failure for the day. SmartFlow takes a different approach:

**Work doesn't disappear just because the day changes.**

If a task is unfinished, SmartFlow preserves the remaining work and intelligently finds another opportunity to complete it.

## 🔮 Future Improvements

Planned improvements include:

* AI-powered task prioritization
* Calendar integration
* Google Calendar synchronization
* Push notifications
* Smarter workload balancing
* Energy/focus-aware scheduling
* Automatic morning and evening planning
* Mobile application release
* Offline synchronization
* Productivity recommendations
* Advanced analytics
* Cloud-based multi-device synchronization
* Natural-language task creation

## 📌 Project Status

**Prototype / Active Development**

SmartFlow Scheduler currently contains the core scheduling engine and a functional productivity-focused user interface. The project is being developed toward a production-ready intelligent scheduling platform.

## 👨‍💻 Author

Developed as an intelligent productivity and scheduling project focused on automatic task management, adaptive planning, and time optimization.
