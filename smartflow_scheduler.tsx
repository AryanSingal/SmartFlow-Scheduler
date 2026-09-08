import React, { useState, useEffect, useContext, createContext, useMemo, useRef } from 'react';
import { 
  CheckCircle2, Clock, Calendar as CalendarIcon, PieChart, Settings as SettingsIcon, 
  Plus, Play, Pause, Square, ChevronRight, ChevronLeft, MoreVertical, 
  Moon, Sun, Zap, AlertCircle, RefreshCw, Filter, List, Trash2, Edit2, PlayCircle,
  Sparkles, Bot, Repeat
} from 'lucide-react';
import { initializeApp } from 'firebase/app';
import { 
  getAuth, signInWithCustomToken, signInAnonymously, onAuthStateChanged, signOut
} from 'firebase/auth';
import { 
  getFirestore, collection, doc, setDoc, deleteDoc, onSnapshot, query, updateDoc, addDoc
} from 'firebase/firestore';

// --- FIREBASE INITIALIZATION ---
let app, auth, db, appId;
try {
  const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : {
    // Dummy config for local testing without injected vars
    apiKey: "dummy", authDomain: "dummy", projectId: "dummy", storageBucket: "dummy", messagingSenderId: "dummy", appId: "dummy"
  };
  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getFirestore(app);
  appId = typeof __app_id !== 'undefined' ? __app_id : 'smartflow-app';
} catch (error) {
  console.error("Firebase init error:", error);
}

// --- HELPER FUNCTIONS (Time Math) ---
const timeToMins = (timeStr) => {
  if (!timeStr) return 0;
  const [h, m] = timeStr.split(':').map(Number);
  return h * 60 + m;
};

const minsToTime = (mins) => {
  const h = Math.floor(mins / 60).toString().padStart(2, '0');
  const m = (mins % 60).toString().padStart(2, '0');
  return `${h}:${m}`;
};

const getTodayStr = () => new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD local

const addDays = (dateStr, days) => {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toLocaleDateString('en-CA');
};

const formatDisplayDate = (dateStr) => {
  if (dateStr === getTodayStr()) return 'Today';
  if (dateStr === addDays(getTodayStr(), 1)) return 'Tomorrow';
  return new Date(dateStr).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
};

// --- GEMINI API INTEGRATION ---
const GEMINI_API_KEY = ""; // Key is injected by the environment

const callGeminiWithBackoff = async (prompt, expectJson = false, schema = null, retries = 5) => {
  const delays = [1000, 2000, 4000, 8000, 16000];
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${GEMINI_API_KEY}`;
  
  const payload = {
    contents: [{ parts: [{ text: prompt }] }],
  };

  if (expectJson) {
    payload.generationConfig = { 
      responseMimeType: "application/json",
      ...(schema && { responseSchema: schema })
    };
  }

  for (let i = 0; i < retries; i++) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      const data = await response.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      
      if (!text) throw new Error("No text returned from Gemini");
      
      return expectJson ? JSON.parse(text) : text;
    } catch (error) {
      if (i === retries - 1) {
        console.error("Gemini API failed after retries:", error);
        throw error;
      }
      await new Promise(res => setTimeout(res, delays[i]));
    }
  }
};


// --- CONTEXT ---
const AppContext = createContext();

// --- SCHEDULING ENGINE ---
// Finds the next available block of time for a given duration
const findNextAvailableSlot = (durationMins, startSearchDate, settings, allTasks) => {
  let currentDayStr = startSearchDate;
  let daysChecked = 0;
  const maxDays = 14; // Search limit

  while (daysChecked < maxDays) {
    const dayTasks = allTasks.filter(t => t.date === currentDayStr && t.status !== 'completed');
    dayTasks.sort((a, b) => timeToMins(a.startTime) - timeToMins(b.startTime));

    let workStart = timeToMins(settings.workStart);
    let workEnd = timeToMins(settings.workEnd);

    // If checking today, don't schedule in the past
    if (currentDayStr === getTodayStr()) {
      const nowMins = new Date().getHours() * 60 + new Date().getMinutes();
      workStart = Math.max(workStart, nowMins + 10); // Buffer of 10 mins
    }

    let currentTime = workStart;

    for (let task of dayTasks) {
      const tStart = timeToMins(task.startTime);
      const tEnd = timeToMins(task.endTime);

      // Check gap before this task
      if (tStart - currentTime >= durationMins) {
        return { 
          date: currentDayStr, 
          startTime: minsToTime(currentTime), 
          endTime: minsToTime(currentTime + durationMins) 
        };
      }
      currentTime = Math.max(currentTime, tEnd);
    }

    // Check gap after last task until work day ends
    if (workEnd - currentTime >= durationMins) {
      return { 
        date: currentDayStr, 
        startTime: minsToTime(currentTime), 
        endTime: minsToTime(currentTime + durationMins) 
      };
    }

    // Move to next day
    currentDayStr = addDays(currentDayStr, 1);
    daysChecked++;
  }
  return null; // No slot found
};


// --- MAIN APP COMPONENT ---
export default function App() {
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  
  // App State
  const [tasks, setTasks] = useState([]);
  const [settings, setSettings] = useState({
    workStart: '09:00',
    workEnd: '18:00',
    theme: 'dark', // 'dark' or 'light'
    onboarded: false
  });
  const [activeTab, setActiveTab] = useState('today');
  const [isInitializing, setIsInitializing] = useState(true);

  // Authentication Effect (Mandatory Rule 3)
  useEffect(() => {
    const initAuth = async () => {
      try {
        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
          await signInWithCustomToken(auth, __initial_auth_token);
        } else {
          await signInAnonymously(auth);
        }
      } catch (err) {
        console.error("Auth Error:", err);
      } finally {
        setAuthLoading(false);
      }
    };
    initAuth();

    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setUser(user);
    });
    return () => unsubscribe();
  }, []);

  // Data Fetching Effect (Mandatory Rule 1 & 2)
  useEffect(() => {
    if (!user) return;
    
    // Fetch Settings
    const settingsRef = doc(db, 'artifacts', appId, 'users', user.uid, 'config', 'settings');
    const unsubSettings = onSnapshot(settingsRef, (docSnap) => {
      if (docSnap.exists()) {
        setSettings(docSnap.data());
      }
      setIsInitializing(false);
    }, (err) => console.error("Settings fetch error", err));

    // Fetch Tasks
    const tasksRef = collection(db, 'artifacts', appId, 'users', user.uid, 'tasks');
    const unsubTasks = onSnapshot(tasksRef, (snapshot) => {
      const tasksData = [];
      snapshot.forEach(doc => tasksData.push({ id: doc.id, ...doc.data() }));
      setTasks(tasksData);
    }, (err) => console.error("Tasks fetch error", err));

    return () => {
      unsubSettings();
      unsubTasks();
    };
  }, [user]);

  // --- ACTIONS ---
  const saveSettings = async (newSettings) => {
    if (!user) return;
    const finalSettings = { ...settings, ...newSettings };
    setSettings(finalSettings);
    await setDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'config', 'settings'), finalSettings);
  };

  const addTask = async (taskData) => {
    if (!user) return;
    const tasksRef = collection(db, 'artifacts', appId, 'users', user.uid, 'tasks');
    await addDoc(tasksRef, {
      ...taskData,
      createdAt: new Date().toISOString(),
      status: taskData.status || 'pending',
      completedDuration: 0
    });
  };

  const updateTask = async (taskId, updates) => {
    if (!user) return;
    const taskRef = doc(db, 'artifacts', appId, 'users', user.uid, 'tasks', taskId);
    await updateDoc(taskRef, updates);
  };

  const deleteTask = async (taskId) => {
    if (!user) return;
    await deleteDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'tasks', taskId));
  };

  // The core rescheduling action
  const handleTaskProgress = async (task, sessionDurationMins, isComplete) => {
    if (!user) return;
    const totalCompleted = (task.completedDuration || 0) + sessionDurationMins;
    const taskDuration = timeToMins(task.endTime) - timeToMins(task.startTime);
    const isActuallyComplete = isComplete || totalCompleted >= taskDuration;

    if (isActuallyComplete) {
      await updateTask(task.id, { status: 'completed', completedDuration: taskDuration });
    } else {
      // Partial completion. 
      // 1. Mark current as partial/completed based on what was done.
      await updateTask(task.id, { 
        status: 'partial', 
        completedDuration: totalCompleted,
        // Shrink the current task's visual block to what was actually worked
        endTime: minsToTime(timeToMins(task.startTime) + sessionDurationMins)
      });

      // 2. Create new task for remainder via Auto-Engine
      const remainingMins = taskDuration - totalCompleted;
      if (remainingMins > 0) {
        const nextSlot = findNextAvailableSlot(remainingMins, getTodayStr(), settings, tasks);
        if (nextSlot) {
          await addTask({
            title: `${task.title} (Cont.)`,
            description: task.description,
            priority: task.priority,
            category: task.category,
            date: nextSlot.date,
            startTime: nextSlot.startTime,
            endTime: nextSlot.endTime,
            status: 'pending',
            isRescheduled: true,
            originalTaskId: task.id
          });
        }
      }
    }
  };

  // Plan My Day Auto-scheduler
  const runPlanMyDay = async () => {
    const today = getTodayStr();
    // Find tasks that are pending but have no times set (dummy trigger for now, assuming user creates tasks without time)
    // For this implementation, let's reschedule overdue tasks from past days to today
    const overdueTasks = tasks.filter(t => t.date < today && t.status === 'pending');
    
    for (let task of overdueTasks) {
      const duration = timeToMins(task.endTime) - timeToMins(task.startTime);
      const nextSlot = findNextAvailableSlot(duration, today, settings, tasks);
      if (nextSlot) {
        await updateTask(task.id, {
          date: nextSlot.date,
          startTime: nextSlot.startTime,
          endTime: nextSlot.endTime,
          isRescheduled: true,
          rescheduleReason: "Auto-planned from overdue"
        });
      }
    }
  };

  if (authLoading || isInitializing) {
    return (
      <div className="min-h-screen bg-[#090C15] flex items-center justify-center">
        <div className="w-12 h-12 border-4 border-cyan-500 border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  const contextValue = {
    user, tasks, settings, saveSettings, addTask, updateTask, deleteTask, handleTaskProgress, runPlanMyDay
  };

  const themeClass = settings.theme === 'light' 
    ? 'bg-slate-50 text-slate-900' 
    : 'bg-[#05070A] text-white'; // Deepened the dark theme base

  return (
    <AppContext.Provider value={contextValue}>
      <div className={`min-h-screen font-sans selection:bg-cyan-500/30 ${themeClass}`}>
        {!settings.onboarded ? (
          <Onboarding />
        ) : (
          <div className="flex flex-col h-screen max-w-md mx-auto shadow-2xl relative overflow-hidden">
            
            {/* CRAZY UI: Animated Background Effects for Dark Theme */}
            {settings.theme === 'dark' && (
              <>
                <div className="absolute -top-20 -left-20 w-[40rem] h-[40rem] bg-purple-600/15 rounded-full blur-[120px] animate-pulse pointer-events-none mix-blend-screen" style={{ animationDuration: '4s' }}></div>
                <div className="absolute top-1/3 -right-32 w-[30rem] h-[30rem] bg-cyan-600/15 rounded-full blur-[100px] animate-pulse pointer-events-none mix-blend-screen" style={{ animationDelay: '2s', animationDuration: '5s' }}></div>
                <div className="absolute -bottom-20 left-10 w-[25rem] h-[25rem] bg-blue-600/15 rounded-full blur-[100px] animate-pulse pointer-events-none mix-blend-screen" style={{ animationDelay: '1s', animationDuration: '6s' }}></div>
              </>
            )}

            {/* Main Content Area */}
            <main className="flex-1 overflow-y-auto pb-32 relative z-10 scrollbar-hide">
              {activeTab === 'today' && <TodayView />}
              {activeTab === 'calendar' && <CalendarView />}
              {activeTab === 'tasks' && <TasksView />}
              {activeTab === 'insights' && <InsightsView />}
              {activeTab === 'settings' && <SettingsView />}
            </main>

            {/* CRAZY UI: Floating Pill Bottom Navigation */}
            <nav className={`absolute bottom-6 left-[5%] w-[90%] px-5 py-3 flex justify-between items-center z-50 rounded-full backdrop-blur-2xl border transition-all duration-500 ${settings.theme === 'dark' ? 'bg-[#0f172a]/70 border-cyan-500/30 shadow-[0_10px_40px_-10px_rgba(6,182,212,0.4)]' : 'bg-white/80 border-blue-200 shadow-[0_10px_40px_-10px_rgba(37,99,235,0.3)]'}`}>
              <NavItem icon={Zap} label="Today" active={activeTab === 'today'} onClick={() => setActiveTab('today')} theme={settings.theme} />
              <NavItem icon={CalendarIcon} label="Calendar" active={activeTab === 'calendar'} onClick={() => setActiveTab('calendar')} theme={settings.theme} />
              
              {/* Glowing FAB */}
              <div className="relative -top-8 group">
                <div className="absolute inset-0 bg-cyan-400 rounded-full blur-md opacity-60 group-hover:opacity-100 transition-opacity"></div>
                <button 
                  onClick={() => window.dispatchEvent(new CustomEvent('open-task-modal'))}
                  className="relative w-16 h-16 rounded-full bg-gradient-to-br from-cyan-400 via-blue-500 to-purple-600 flex items-center justify-center text-white shadow-xl hover:scale-110 transition-transform duration-300 border-2 border-white/20"
                >
                  <Plus size={32} />
                </button>
              </div>

              <NavItem icon={PieChart} label="Insights" active={activeTab === 'insights'} onClick={() => setActiveTab('insights')} theme={settings.theme} />
              <NavItem icon={SettingsIcon} label="Settings" active={activeTab === 'settings'} onClick={() => setActiveTab('settings')} theme={settings.theme} />
            </nav>

            <TaskModal />
            <FocusTimerModal />
          </div>
        )}
      </div>
    </AppContext.Provider>
  );
}

// --- COMPONENTS ---

const NavItem = ({ icon: Icon, label, active, onClick, theme }) => {
  const isDark = theme === 'dark';
  return (
    <button onClick={onClick} className="flex flex-col items-center justify-center w-12 gap-1 group">
      <div className={`p-2 rounded-xl transition-all duration-300 ${active ? (isDark ? 'bg-cyan-500/20 text-cyan-400' : 'bg-blue-100 text-blue-600') : (isDark ? 'text-slate-400 hover:text-slate-200' : 'text-slate-400 hover:text-slate-600')}`}>
        <Icon size={22} strokeWidth={active ? 2.5 : 2} />
      </div>
      <span className={`text-[10px] font-medium transition-colors ${active ? (isDark ? 'text-cyan-400' : 'text-blue-600') : 'text-transparent group-hover:text-slate-400'}`}>
        {label}
      </span>
    </button>
  );
};

// --- ONBOARDING ---
const Onboarding = () => {
  const { saveSettings, settings } = useContext(AppContext);
  const [start, setStart] = useState(settings.workStart);
  const [end, setEnd] = useState(settings.workEnd);

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-[#090C15] text-white">
      <div className="max-w-md w-full p-8 rounded-3xl bg-white/5 border border-white/10 backdrop-blur-lg shadow-2xl relative overflow-hidden">
        <div className="absolute top-0 right-0 w-32 h-32 bg-cyan-500/20 rounded-full blur-[50px]"></div>
        
        <div className="flex justify-center mb-6">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-tr from-cyan-500 to-blue-600 flex items-center justify-center shadow-lg">
            <Zap size={32} className="text-white" />
          </div>
        </div>
        
        <h1 className="text-3xl font-bold text-center mb-2 bg-clip-text text-transparent bg-gradient-to-r from-white to-slate-400">SmartFlow</h1>
        <p className="text-center text-slate-400 mb-8">Let's set up your core working hours for the intelligent scheduler.</p>
        
        <div className="space-y-6 mb-10">
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">Day Starts At</label>
            <input type="time" value={start} onChange={e => setStart(e.target.value)} className="w-full bg-black/30 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-cyan-500 transition-colors" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">Day Ends At</label>
            <input type="time" value={end} onChange={e => setEnd(e.target.value)} className="w-full bg-black/30 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-cyan-500 transition-colors" />
          </div>
        </div>
        
        <button 
          onClick={() => saveSettings({ workStart: start, workEnd: end, onboarded: true })}
          className="w-full py-4 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 text-white font-semibold text-lg shadow-[0_0_20px_rgba(6,182,212,0.3)] hover:opacity-90 transition-opacity flex items-center justify-center gap-2"
        >
          Initialize Engine <ChevronRight size={20} />
        </button>
      </div>
    </div>
  );
};

// --- VIEWS ---

const TodayView = () => {
  const { tasks, settings, runPlanMyDay } = useContext(AppContext);
  const today = getTodayStr();
  const todayTasks = tasks.filter(t => t.date === today).sort((a, b) => timeToMins(a.startTime) - timeToMins(b.startTime));
  
  const completedCount = todayTasks.filter(t => t.status === 'completed').length;
  const totalCount = todayTasks.length;
  const progress = totalCount === 0 ? 0 : Math.round((completedCount / totalCount) * 100);

  const isDark = settings.theme === 'dark';
  const cardBg = isDark ? 'bg-white/5 border-white/10' : 'bg-white border-slate-100 shadow-sm';
  const textMain = isDark ? 'text-white' : 'text-slate-900';
  const textSub = isDark ? 'text-slate-400' : 'text-slate-500';

  return (
    <div className="p-6 pt-12 pb-24 space-y-8 relative">
      {/* Header */}
      <div className="flex justify-between items-center relative z-10">
        <div>
          <h1 className={`text-4xl font-extrabold tracking-tight bg-clip-text text-transparent ${isDark ? 'bg-gradient-to-r from-white to-slate-400' : 'bg-gradient-to-r from-slate-900 to-slate-500'}`}>Today</h1>
          <p className={textSub}>{new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</p>
        </div>
        <button onClick={runPlanMyDay} className={`p-3 rounded-full shadow-lg ${isDark ? 'bg-white/5 border border-white/10 hover:bg-white/10 text-cyan-400 hover:shadow-[0_0_15px_rgba(6,182,212,0.3)]' : 'bg-blue-50 border border-blue-100 hover:bg-blue-100 text-blue-600'} transition-all`} title="Auto-Plan Overdue">
          <RefreshCw size={22} />
        </button>
      </div>

      {/* Progress Ring Card - Crazy UI */}
      <div className={`p-6 rounded-[2rem] border backdrop-blur-xl flex items-center justify-between relative overflow-hidden transition-all hover:scale-[1.02] duration-300 shadow-xl ${isDark ? 'bg-white/5 border-white/10 shadow-black/50' : 'bg-white border-blue-100 shadow-blue-500/5'}`}>
        {isDark && (
           <>
             <div className="absolute -right-10 -top-10 w-40 h-40 bg-gradient-to-br from-cyan-500/20 to-purple-500/20 rounded-full blur-2xl"></div>
             <div className="absolute left-0 bottom-0 w-full h-1 bg-gradient-to-r from-cyan-500 via-blue-500 to-purple-500 opacity-50"></div>
           </>
        )}
        <div className="z-10">
          <h3 className={`text-sm font-semibold tracking-wide uppercase ${isDark ? 'text-cyan-400' : 'text-blue-600'}`}>Daily Progress</h3>
          <p className={`text-3xl font-black mt-1 ${textMain}`}>{completedCount} <span className={`text-base font-medium ${textSub}`}>/ {totalCount} tasks</span></p>
          <div className="mt-4 flex gap-2">
             <span className={`inline-flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-lg ${isDark ? 'bg-green-500/10 text-green-400 border border-green-500/20' : 'bg-green-50 text-green-600 border border-green-200'}`}>
               <CheckCircle2 size={14} /> {completedCount} Done
             </span>
          </div>
        </div>
        
        {/* Custom SVG Progress Ring */}
        <div className="relative w-28 h-28 z-10 filter drop-shadow-lg">
          <svg className="w-full h-full transform -rotate-90" viewBox="0 0 100 100">
            <circle cx="50" cy="50" r="40" className={`fill-none stroke-current ${isDark ? 'text-white/5' : 'text-slate-100'}`} strokeWidth="8" />
            <circle cx="50" cy="50" r="40" className="fill-none stroke-cyan-500 transition-all duration-1000 ease-out drop-shadow-[0_0_8px_rgba(6,182,212,0.8)]" strokeWidth="8" strokeLinecap="round" 
              style={{ strokeDasharray: 251.2, strokeDashoffset: 251.2 - (251.2 * progress) / 100 }} 
            />
          </svg>
          <div className="absolute inset-0 flex items-center justify-center flex-col">
            <span className={`text-2xl font-black ${textMain}`}>{progress}%</span>
          </div>
        </div>
      </div>

      {/* Timeline */}
      <div className="relative z-10">
        <h2 className={`text-xl font-bold mb-6 ${textMain} flex items-center gap-2`}><Clock className="text-cyan-500"/> Timeline</h2>
        {todayTasks.length === 0 ? (
          <div className={`text-center py-12 border-2 rounded-[2rem] border-dashed backdrop-blur-sm ${isDark ? 'border-white/10 text-slate-500 bg-white/5' : 'border-slate-200 text-slate-400 bg-slate-50'}`}>
            <Sparkles className="mx-auto mb-3 opacity-50" size={32} />
            <p className="font-medium text-lg">Your day is clear!</p>
            <button onClick={() => window.dispatchEvent(new CustomEvent('open-task-modal'))} className="mt-3 text-cyan-500 font-bold bg-cyan-500/10 px-4 py-2 rounded-xl hover:bg-cyan-500/20 transition-colors">Plan something awesome</button>
          </div>
        ) : (
          <div className="space-y-6 relative before:absolute before:inset-0 before:ml-[1.25rem] before:-translate-x-px md:before:mx-auto md:before:translate-x-0 before:h-full before:w-1 before:bg-gradient-to-b before:from-cyan-500 before:via-purple-500 before:to-transparent before:rounded-full before:opacity-30">
            {todayTasks.map((task, index) => (
              <TaskCard key={task.id} task={task} theme={settings.theme} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

const TaskCard = ({ task, theme }) => {
  const isDark = theme === 'dark';
  const isCompleted = task.status === 'completed';
  const isPartial = task.status === 'partial';
  
  const priorityColors = {
    High: isDark ? 'text-rose-400 bg-rose-400/10 border-rose-400/20' : 'text-rose-600 bg-rose-50 border-rose-200',
    Medium: isDark ? 'text-amber-400 bg-amber-400/10 border-amber-400/20' : 'text-amber-600 bg-amber-50 border-amber-200',
    Low: isDark ? 'text-emerald-400 bg-emerald-400/10 border-emerald-400/20' : 'text-emerald-600 bg-emerald-50 border-emerald-200'
  };

  const openTimer = () => {
    if(!isCompleted) window.dispatchEvent(new CustomEvent('open-timer', { detail: task }));
  };

  return (
    <div className="relative flex items-start group">
      {/* Timeline dot */}
      <div className={`absolute left-0 w-10 h-full flex items-center justify-center`}>
        <div className={`w-4 h-4 rounded-full z-10 transition-transform group-hover:scale-125 ${isCompleted ? 'bg-green-500 shadow-[0_0_15px_rgba(34,197,94,0.5)]' : (task.isRescheduled ? 'bg-purple-500 shadow-[0_0_15px_rgba(168,85,247,0.5)]' : 'bg-cyan-500 shadow-[0_0_15px_rgba(6,182,212,0.5)] border-2 border-white')}`}></div>
      </div>
      
      {/* Card Content - Crazy UI */}
      <div className={`ml-12 w-full p-5 rounded-[1.5rem] border backdrop-blur-md transition-all duration-300 ${isDark ? 'bg-[#151b2b]/80 border-white/10 hover:border-cyan-500/50 hover:bg-[#1a2133] hover:shadow-[0_0_30px_rgba(6,182,212,0.15)] hover:-translate-y-1' : 'bg-white border-slate-200 shadow-sm hover:shadow-xl hover:border-blue-300 hover:-translate-y-1'}`}>
        <div className="flex justify-between items-start mb-3">
          <div className="flex items-center gap-2">
            <span className={`text-xs font-bold ${isDark ? 'text-slate-300' : 'text-slate-600'} flex items-center gap-1.5 bg-black/20 px-2 py-1 rounded-md`}>
              <Clock size={14} className="text-cyan-400" /> {task.startTime} - {task.endTime}
            </span>
            {task.isRescheduled && (
              <span className="text-[10px] uppercase tracking-widest font-black text-purple-400 bg-purple-500/20 border border-purple-500/30 px-2.5 py-1 rounded-md flex items-center gap-1"><RefreshCw size={10}/> Rescheduled</span>
            )}
          </div>
          <span className={`text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-md border ${priorityColors[task.priority] || priorityColors.Medium}`}>
            {task.priority || 'Medium'}
          </span>
        </div>
        
        <h3 className={`font-bold text-lg leading-tight ${isCompleted ? 'line-through opacity-40' : ''} ${isDark ? 'text-white' : 'text-slate-900'}`}>{task.title}</h3>
        {task.category && (
           <div className="flex gap-2 mt-2">
             <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${isDark ? 'bg-white/10 text-slate-300' : 'bg-slate-100 text-slate-600'}`}>{task.category}</span>
             {task.recurrence && task.recurrence !== 'None' && (
                <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full flex items-center gap-1 ${isDark ? 'bg-blue-500/20 text-blue-300' : 'bg-blue-100 text-blue-600'}`}><Repeat size={10}/> {task.recurrence}</span>
             )}
           </div>
        )}
        
        <div className="mt-5 flex justify-between items-center">
          <div className="flex -space-x-2">
            {/* Visual spacer */}
          </div>
          
          {!isCompleted ? (
            <button onClick={openTimer} className="flex items-center gap-2 text-sm font-bold text-white bg-gradient-to-r from-cyan-500 to-blue-600 hover:shadow-[0_0_20px_rgba(6,182,212,0.4)] px-4 py-2 rounded-xl transition-all hover:scale-105 active:scale-95">
              <PlayCircle size={18} /> Focus
            </button>
          ) : (
            <span className="flex items-center gap-1.5 text-sm font-bold text-green-500 bg-green-500/10 px-3 py-1.5 rounded-xl border border-green-500/20">
              <CheckCircle2 size={18} /> Completed
            </span>
          )}
        </div>
      </div>
    </div>
  );
};

const CalendarView = () => {
  const { tasks, settings } = useContext(AppContext);
  const isDark = settings.theme === 'dark';
  const textMain = isDark ? 'text-white' : 'text-slate-900';
  const bgCard = isDark ? 'bg-white/5 border-white/10' : 'bg-white border-slate-200';

  // Simple implementation: Just show next 7 days list
  const nextDays = Array.from({length: 7}).map((_, i) => addDays(getTodayStr(), i));

  return (
    <div className="p-6 pt-12 pb-24">
       <h1 className={`text-3xl font-bold tracking-tight mb-6 ${textMain}`}>Calendar</h1>
       <div className="space-y-6">
         {nextDays.map(dateStr => {
           const dayTasks = tasks.filter(t => t.date === dateStr).sort((a,b) => timeToMins(a.startTime) - timeToMins(b.startTime));
           return (
             <div key={dateStr} className={`p-4 rounded-2xl border ${bgCard}`}>
               <h3 className={`font-bold mb-3 border-b pb-2 ${isDark ? 'border-white/10 text-slate-200' : 'border-slate-100 text-slate-700'}`}>
                 {formatDisplayDate(dateStr)}
               </h3>
               {dayTasks.length === 0 ? (
                 <p className={`text-sm ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>No tasks scheduled.</p>
               ) : (
                 <div className="space-y-2">
                   {dayTasks.map(t => (
                     <div key={t.id} className="flex justify-between items-center text-sm">
                       <span className={`truncate pr-4 ${isDark ? 'text-slate-300' : 'text-slate-600'}`}>{t.title}</span>
                       <span className={`shrink-0 font-medium ${isDark ? 'text-cyan-400' : 'text-blue-600'}`}>{t.startTime}</span>
                     </div>
                   ))}
                 </div>
               )}
             </div>
           )
         })}
       </div>
    </div>
  )
}

const TasksView = () => {
  const { tasks, settings, deleteTask } = useContext(AppContext);
  const isDark = settings.theme === 'dark';
  const textMain = isDark ? 'text-white' : 'text-slate-900';
  const textSub = isDark ? 'text-slate-400' : 'text-slate-500';
  const bgCard = isDark ? 'bg-white/5 border-white/10' : 'bg-white border-slate-200';

  return (
    <div className="p-6 pt-12 pb-24">
       <div className="flex justify-between items-center mb-6">
         <h1 className={`text-3xl font-bold tracking-tight ${textMain}`}>All Tasks</h1>
         <button className={`p-2 rounded-lg ${isDark ? 'bg-white/5' : 'bg-slate-100'}`}><Filter size={20} className={textMain} /></button>
       </div>

       <div className="space-y-3">
         {tasks.sort((a,b) => new Date(a.date) - new Date(b.date)).map(task => (
           <div key={task.id} className={`p-4 rounded-xl border flex items-center justify-between ${bgCard}`}>
             <div className="min-w-0 flex-1">
               <h4 className={`font-semibold truncate ${task.status === 'completed' ? 'line-through opacity-50' : ''} ${textMain}`}>{task.title}</h4>
               <p className={`text-xs truncate ${textSub}`}>{formatDisplayDate(task.date)} • {task.startTime}</p>
             </div>
             <div className="flex items-center gap-2 ml-4">
               <button onClick={() => deleteTask(task.id)} className="p-2 text-rose-500 hover:bg-rose-500/10 rounded-lg transition-colors">
                 <Trash2 size={16} />
               </button>
             </div>
           </div>
         ))}
       </div>
    </div>
  )
}

const InsightsView = () => {
  const { tasks, settings } = useContext(AppContext);
  const isDark = settings.theme === 'dark';
  const textMain = isDark ? 'text-white' : 'text-slate-900';
  const bgCard = isDark ? 'bg-white/5 border-white/10' : 'bg-white border-slate-200 shadow-sm';

  const [aiFeedback, setAiFeedback] = useState(null);
  const [isAiLoading, setIsAiLoading] = useState(false);

  // Calc stats
  const completed = tasks.filter(t => t.status === 'completed').length;
  const rescheduled = tasks.filter(t => t.isRescheduled).length;
  
  // Custom simple bar chart data (last 5 days)
  const last5Days = Array.from({length: 5}).map((_, i) => addDays(getTodayStr(), -4 + i));
  const chartData = last5Days.map(date => {
    const dayTasks = tasks.filter(t => t.date === date);
    const done = dayTasks.filter(t => t.status === 'completed').length;
    return { date: new Date(date).toLocaleDateString('en-US', {weekday:'short'}), done, total: dayTasks.length || 1 }; // fallback 1 to avoid /0
  });

  const fetchAiInsight = async () => {
    setIsAiLoading(true);
    try {
      const recentTasks = tasks.filter(t => t.date >= addDays(getTodayStr(), -7));
      const recentCompleted = recentTasks.filter(t => t.status === 'completed').length;
      const recentPartial = recentTasks.filter(t => t.status === 'partial').length;
      const categories = [...new Set(recentTasks.map(t => t.category).filter(Boolean))].join(', ') || 'General';
      
      const prompt = `Act as an expert productivity coach. Here is my data for the last 7 days: I completed ${recentCompleted} tasks, and had to reschedule/partially complete ${recentPartial} tasks. My main working categories are: ${categories}. Write a short, encouraging 2-sentence performance review, and provide one unique, highly actionable productivity tip based on this data. Format it playfully but professionally.`;
      
      const feedback = await callGeminiWithBackoff(prompt, false);
      setAiFeedback(feedback);
    } catch(e) {
      setAiFeedback("Unable to reach the AI Coach right now. Keep up the great work!");
    } finally {
      setIsAiLoading(false);
    }
  };

  return (
    <div className="p-6 pt-12 pb-24">
       <h1 className={`text-3xl font-bold tracking-tight mb-6 ${textMain}`}>Insights</h1>
       
       {/* ✨ AI Coach Section */}
       <div className={`p-5 rounded-3xl border mb-8 relative overflow-hidden ${isDark ? 'bg-gradient-to-br from-cyan-900/20 to-purple-900/20 border-cyan-500/30' : 'bg-gradient-to-br from-blue-50 to-purple-50 border-blue-200'}`}>
         {isDark && <div className="absolute -top-10 -right-10 w-32 h-32 bg-cyan-500/20 rounded-full blur-3xl"></div>}
         
         <div className="flex items-center gap-3 mb-4 relative z-10">
           <div className={`p-2 rounded-xl ${isDark ? 'bg-cyan-500/20 text-cyan-400' : 'bg-blue-100 text-blue-600'}`}>
             <Bot size={24} />
           </div>
           <h3 className={`font-bold text-lg ${textMain}`}>AI Productivity Coach</h3>
         </div>

         {aiFeedback ? (
           <div className={`text-sm leading-relaxed relative z-10 ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>
             {aiFeedback}
           </div>
         ) : (
           <div className="relative z-10">
             <p className={`text-sm mb-4 ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>Get personalized insights and schedule adjustments based on your recent workflow patterns.</p>
             <button 
               onClick={fetchAiInsight}
               disabled={isAiLoading}
               className={`flex items-center gap-2 px-4 py-2.5 rounded-xl font-medium transition-all ${isAiLoading ? 'opacity-70 cursor-not-allowed' : 'hover:scale-105'} ${isDark ? 'bg-white/10 text-cyan-400 border border-white/10' : 'bg-white text-blue-600 shadow-sm border border-blue-100'}`}
             >
               {isAiLoading ? (
                 <><div className="w-4 h-4 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin"></div> Analyzing...</>
               ) : (
                 <><Sparkles size={16} /> ✨ Generate AI Insights</>
               )}
             </button>
           </div>
         )}
       </div>

       <div className="grid grid-cols-2 gap-4 mb-8">
         <div className={`p-4 rounded-2xl border ${bgCard}`}>
           <p className={`text-sm ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>Total Completed</p>
           <p className={`text-3xl font-bold mt-1 text-green-500`}>{completed}</p>
         </div>
         <div className={`p-4 rounded-2xl border ${bgCard}`}>
           <p className={`text-sm ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>Engine Reschedules</p>
           <p className={`text-3xl font-bold mt-1 text-purple-500`}>{rescheduled}</p>
         </div>
       </div>

       <div className={`p-5 rounded-3xl border ${bgCard}`}>
         <h3 className={`font-semibold mb-6 ${textMain}`}>Productivity Trend</h3>
         <div className="flex items-end justify-between h-40 gap-2">
           {chartData.map((data, i) => {
             const heightPct = Math.min((data.done / Math.max(...chartData.map(d=>d.total))) * 100, 100) || 5;
             return (
               <div key={i} className="flex flex-col items-center flex-1 group">
                 <div className="w-full relative h-full flex items-end justify-center rounded-t-md overflow-hidden bg-white/5">
                    <div 
                      className="w-full bg-gradient-to-t from-cyan-600 to-cyan-400 rounded-t-md transition-all duration-700 ease-out"
                      style={{ height: `${heightPct}%` }}
                    ></div>
                 </div>
                 <span className={`text-[10px] mt-2 ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>{data.date}</span>
               </div>
             )
           })}
         </div>
       </div>
    </div>
  )
}

const SettingsView = () => {
  const { settings, saveSettings } = useContext(AppContext);
  const isDark = settings.theme === 'dark';
  const textMain = isDark ? 'text-white' : 'text-slate-900';
  const bgCard = isDark ? 'bg-white/5 border-white/10' : 'bg-white border-slate-200';

  const toggleTheme = () => {
    saveSettings({ theme: isDark ? 'light' : 'dark' });
  };

  return (
    <div className="p-6 pt-12 pb-24">
       <h1 className={`text-3xl font-bold tracking-tight mb-6 ${textMain}`}>Settings</h1>
       
       <div className="space-y-4">
         <div className={`p-4 rounded-2xl border flex items-center justify-between ${bgCard}`}>
           <div className="flex items-center gap-3">
             {isDark ? <Moon className="text-purple-400" /> : <Sun className="text-amber-500" />}
             <span className={`font-medium ${textMain}`}>Appearance</span>
           </div>
           <button 
             onClick={toggleTheme}
             className={`w-12 h-6 rounded-full relative transition-colors ${isDark ? 'bg-cyan-500' : 'bg-slate-300'}`}
           >
             <div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform ${isDark ? 'left-7' : 'left-1'}`}></div>
           </button>
         </div>

         <div className={`p-5 rounded-2xl border space-y-4 ${bgCard}`}>
           <h3 className={`font-medium mb-2 ${textMain} flex items-center gap-2`}><Clock size={18}/> Working Hours</h3>
           <div>
              <label className={`block text-xs mb-1 ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>Start Time</label>
              <input type="time" value={settings.workStart} onChange={e => saveSettings({workStart: e.target.value})} 
                className={`w-full p-2 rounded-lg border focus:outline-none ${isDark ? 'bg-black/50 border-white/10 text-white' : 'bg-slate-50 border-slate-200 text-slate-900'}`} />
           </div>
           <div>
              <label className={`block text-xs mb-1 ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>End Time</label>
              <input type="time" value={settings.workEnd} onChange={e => saveSettings({workEnd: e.target.value})} 
                className={`w-full p-2 rounded-lg border focus:outline-none ${isDark ? 'bg-black/50 border-white/10 text-white' : 'bg-slate-50 border-slate-200 text-slate-900'}`} />
           </div>
         </div>
       </div>
    </div>
  )
}

// --- MODALS ---

const TaskModal = () => {
  const { addTask, settings, tasks } = useContext(AppContext);
  const [isOpen, setIsOpen] = useState(false);
  const [isAiLoading, setIsAiLoading] = useState(false);
  const isDark = settings.theme === 'dark';
  
  const [formData, setFormData] = useState({
    title: '', description: '', date: getTodayStr(), 
    startTime: '10:00', endTime: '11:00', priority: 'Medium', category: 'Work', recurrence: 'None'
  });

  useEffect(() => {
    const handleOpen = () => setIsOpen(true);
    window.addEventListener('open-task-modal', handleOpen);
    return () => window.removeEventListener('open-task-modal', handleOpen);
  }, []);

  if (!isOpen) return null;

  // Handles Batch Recurring Tasks & Normal Tasks
  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsAiLoading(true); // Re-using AI loading state to show spinner for batch creation
    
    try {
      const [y, m, d] = formData.date.split('-');
      const baseDate = new Date(y, m - 1, d); // Prevents timezone shifting
      
      let tasksToCreate = [];
      let maxTasks = 1;

      if (formData.recurrence === 'Daily') maxTasks = 14; // Next 2 weeks
      else if (formData.recurrence === 'Weekdays') maxTasks = 14; // Next 14 weekdays (~3 weeks)
      else if (formData.recurrence === 'Weekly') maxTasks = 12; // Next 3 months
      else if (formData.recurrence === 'Monthly') maxTasks = 6; // Next 6 months

      let count = 0;
      let currentDate = new Date(baseDate);

      while (count < maxTasks) {
        const dateString = currentDate.toLocaleDateString('en-CA');
        
        if (formData.recurrence === 'Weekdays') {
          const day = currentDate.getDay();
          if (day !== 0 && day !== 6) {
            tasksToCreate.push({ ...formData, date: dateString });
            count++;
          }
        } else {
          tasksToCreate.push({ ...formData, date: dateString });
          count++;
        }

        if (formData.recurrence === 'Daily' || formData.recurrence === 'Weekdays') {
          currentDate.setDate(currentDate.getDate() + 1);
        } else if (formData.recurrence === 'Weekly') {
          currentDate.setDate(currentDate.getDate() + 7);
        } else if (formData.recurrence === 'Monthly') {
          currentDate.setMonth(currentDate.getMonth() + 1);
        } else {
          break; // 'None'
        }
      }

      for (const t of tasksToCreate) {
        await addTask(t);
      }
      
      setIsOpen(false);
      setFormData({ title: '', description: '', date: getTodayStr(), startTime: '10:00', endTime: '11:00', priority: 'Medium', category: 'Work', recurrence: 'None' });
    } catch (error) {
      console.error("Error generating tasks", error);
    } finally {
      setIsAiLoading(false);
    }
  };

  const handleAiBreakdown = async () => {
    if (!formData.title) return alert("Please enter a Task Title first!");
    setIsAiLoading(true);
    
    try {
      const prompt = `Break down the following complex task into 3 to 5 smaller, actionable sub-tasks. 
      Task: "${formData.title}". 
      Context/Description: "${formData.description}". 
      Return an array of objects.`;

      const schema = {
        type: "ARRAY",
        items: {
          type: "OBJECT",
          properties: {
            title: { type: "STRING", description: "Short title of the sub-task" },
            durationMins: { type: "INTEGER", description: "Realistic duration in minutes (e.g., 15, 30, 45, 60)" },
            priority: { type: "STRING", description: "Either 'High', 'Medium', or 'Low'" }
          },
          required: ["title", "durationMins", "priority"]
        }
      };

      const subTasks = await callGeminiWithBackoff(prompt, true, schema);
      
      // Simulate scheduling these new tasks using the engine
      let simulatedTasks = [...tasks];
      let schedulingFailed = false;

      for (const st of subTasks) {
        const slot = findNextAvailableSlot(st.durationMins, formData.date, settings, simulatedTasks);
        if (slot) {
          const newTask = {
            title: st.title,
            description: `Auto-generated part of: ${formData.title}`,
            priority: st.priority,
            category: formData.category || 'General',
            date: slot.date,
            startTime: slot.startTime,
            endTime: slot.endTime,
            status: 'pending',
            isRescheduled: false,
            recurrence: 'None'
          };
          simulatedTasks.push(newTask); // Update array so next sub-task finds the NEXT slot
          await addTask(newTask);
        } else {
          schedulingFailed = true;
        }
      }

      if (schedulingFailed) {
        alert("Some sub-tasks couldn't fit in your schedule and were skipped. Consider extending your working hours.");
      }
      
      setIsOpen(false);
      setFormData({ title: '', description: '', date: getTodayStr(), startTime: '10:00', endTime: '11:00', priority: 'Medium', category: 'Work', recurrence: 'None' });

    } catch (e) {
      console.error(e);
      alert("Failed to connect to the AI breakdown engine. Try again later.");
    } finally {
      setIsAiLoading(false);
    }
  };

  const inputClass = `w-full p-3.5 rounded-xl border-2 focus:outline-none focus:border-cyan-500 transition-colors font-medium ${isDark ? 'bg-black/50 border-white/10 text-white focus:bg-black' : 'bg-slate-50 border-slate-200 text-slate-900 focus:bg-white'}`;
  const labelClass = `block text-xs font-bold uppercase tracking-wider mb-2 ${isDark ? 'text-cyan-400' : 'text-blue-600'}`;

  return (
    <div className="fixed inset-0 z-[100] flex items-end justify-center sm:items-center p-0 sm:p-4 bg-black/60 backdrop-blur-md animate-in fade-in duration-300">
      <div className={`w-full max-w-md h-[90vh] sm:h-auto rounded-t-[2rem] sm:rounded-[2rem] flex flex-col shadow-2xl overflow-hidden border ${isDark ? 'bg-[#0F1423] border-white/10 shadow-black' : 'bg-white border-slate-200 shadow-slate-300'}`}>
        
        <div className={`flex justify-between items-center p-6 border-b relative ${isDark ? 'border-white/10 bg-black/20' : 'border-slate-100 bg-slate-50'}`}>
          <h2 className={`text-2xl font-black tracking-tight ${isDark ? 'text-white' : 'text-slate-900'}`}>New Task</h2>
          <button onClick={() => setIsOpen(false)} className={`p-2 rounded-full transition-transform hover:scale-110 ${isDark ? 'bg-white/10 text-white hover:bg-white/20' : 'bg-slate-200 text-slate-600 hover:bg-slate-300'}`}>✕</button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 scrollbar-hide">
          <form id="task-form" onSubmit={handleSubmit} className="space-y-6">
            <div>
              <label className={labelClass}>Task Title</label>
              <input required type="text" placeholder="What needs to be done?" 
                value={formData.title} onChange={e => setFormData({...formData, title: e.target.value})} 
                className={inputClass} autoFocus />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={labelClass}>Date</label>
                <input required type="date" value={formData.date} onChange={e => setFormData({...formData, date: e.target.value})} className={inputClass} />
              </div>
              <div>
                <label className={labelClass}>Repeat</label>
                <select value={formData.recurrence} onChange={e => setFormData({...formData, recurrence: e.target.value})} className={inputClass}>
                  <option value="None">Once</option>
                  <option value="Daily">Daily</option>
                  <option value="Weekdays">Weekdays (Mon-Fri)</option>
                  <option value="Weekly">Weekly</option>
                  <option value="Monthly">Monthly</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={labelClass}>Start Time</label>
                <input required type="time" value={formData.startTime} onChange={e => setFormData({...formData, startTime: e.target.value})} className={inputClass} />
              </div>
              <div>
                <label className={labelClass}>End Time</label>
                <input required type="time" value={formData.endTime} onChange={e => setFormData({...formData, endTime: e.target.value})} className={inputClass} />
              </div>
            </div>
            
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={labelClass}>Category</label>
                <input type="text" placeholder="e.g. Work, Gym" value={formData.category} onChange={e => setFormData({...formData, category: e.target.value})} className={inputClass} />
              </div>
              <div>
                <label className={labelClass}>Priority</label>
                <select value={formData.priority} onChange={e => setFormData({...formData, priority: e.target.value})} className={inputClass}>
                  <option>Low</option><option>Medium</option><option>High</option>
                </select>
              </div>
            </div>

            <div>
              <label className={labelClass}>Notes</label>
              <textarea rows="2" placeholder="Optional details..." value={formData.description} onChange={e => setFormData({...formData, description: e.target.value})} className={inputClass}></textarea>
            </div>
          </form>
        </div>

        <div className={`p-6 border-t space-y-3 relative overflow-hidden ${isDark ? 'border-white/10 bg-black/40' : 'border-slate-100 bg-slate-50'}`}>
          <button 
            type="button"
            onClick={handleAiBreakdown}
            disabled={isAiLoading || !formData.title}
            className={`w-full py-4 rounded-xl border-2 border-dashed font-bold tracking-wide transition-all flex items-center justify-center gap-2 relative overflow-hidden ${isAiLoading ? 'opacity-50' : 'hover:scale-[1.02]'} ${isDark ? 'border-purple-500/50 text-purple-400 bg-purple-500/10 hover:border-purple-400' : 'border-purple-300 text-purple-600 bg-purple-50 hover:bg-purple-100'}`}
          >
            {isAiLoading ? (
               <><div className="w-5 h-5 border-4 border-current border-t-transparent rounded-full animate-spin"></div> Processing...</>
            ) : (
               <><Sparkles size={20} /> ✨ Auto-Breakdown Tasks</>
            )}
          </button>

          <button form="task-form" type="submit" disabled={isAiLoading} className="w-full py-4 rounded-xl bg-gradient-to-r from-cyan-500 via-blue-500 to-purple-600 text-white font-black text-lg shadow-[0_0_20px_rgba(6,182,212,0.4)] hover:shadow-[0_0_30px_rgba(6,182,212,0.6)] hover:scale-[1.02] transition-all disabled:opacity-50 flex items-center justify-center gap-2">
            {isAiLoading ? "Saving Batch..." : "Schedule Task"}
          </button>
        </div>

      </div>
    </div>
  );
};

const FocusTimerModal = () => {
  const { handleTaskProgress, settings } = useContext(AppContext);
  const [task, setTask] = useState(null);
  const [elapsedSecs, setElapsedSecs] = useState(0);
  const [isRunning, setIsRunning] = useState(false);
  const timerRef = useRef(null);

  const isDark = settings.theme === 'dark';

  useEffect(() => {
    const handleOpen = (e) => {
      setTask(e.detail);
      setElapsedSecs(0);
      setIsRunning(true);
    };
    window.addEventListener('open-timer', handleOpen);
    return () => window.removeEventListener('open-timer', handleOpen);
  }, []);

  useEffect(() => {
    if (isRunning) {
      timerRef.current = setInterval(() => setElapsedSecs(s => s + 1), 1000);
    } else {
      clearInterval(timerRef.current);
    }
    return () => clearInterval(timerRef.current);
  }, [isRunning]);

  if (!task) return null;

  const totalDurationMins = timeToMins(task.endTime) - timeToMins(task.startTime);
  const totalSecs = totalDurationMins * 60;
  const progressPct = Math.min((elapsedSecs / totalSecs) * 100, 100);

  const formatTime = (totalS) => {
    const h = Math.floor(totalS / 3600);
    const m = Math.floor((totalS % 3600) / 60);
    const s = totalS % 60;
    if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const stopAndSave = (isComplete = false) => {
    setIsRunning(false);
    const elapsedMins = Math.round(elapsedSecs / 60);
    handleTaskProgress(task, elapsedMins, isComplete);
    setTask(null);
  };

  return (
    <div className="fixed inset-0 z-[200] bg-[#090C15] flex flex-col items-center justify-center p-6 text-white overflow-hidden">
      {/* Immersive Background */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[150vw] h-[150vw] bg-cyan-900/10 rounded-full blur-[100px] pointer-events-none animate-pulse"></div>
      
      <div className="relative z-10 w-full max-w-sm flex flex-col items-center text-center">
        
        <p className="text-cyan-400 font-medium tracking-widest uppercase text-xs mb-8 flex items-center gap-2">
          <Zap size={14}/> Focus Session
        </p>
        
        <h2 className="text-3xl font-bold mb-2 truncate w-full">{task.title}</h2>
        <p className="text-slate-400 text-sm mb-12">Target: {totalDurationMins} minutes</p>

        {/* Big Circular Timer */}
        <div className="relative w-64 h-64 mb-16">
          <svg className="w-full h-full transform -rotate-90 drop-shadow-[0_0_15px_rgba(6,182,212,0.3)]" viewBox="0 0 100 100">
            <circle cx="50" cy="50" r="45" className="fill-none stroke-white/5" strokeWidth="2" />
            <circle cx="50" cy="50" r="45" className="fill-none stroke-cyan-500 transition-all duration-1000 ease-linear" strokeWidth="4" strokeLinecap="round" 
              style={{ strokeDasharray: 282.7, strokeDashoffset: 282.7 - (282.7 * progressPct) / 100 }} 
            />
          </svg>
          <div className="absolute inset-0 flex items-center justify-center flex-col">
            <span className="text-5xl font-light font-mono tracking-tighter">{formatTime(elapsedSecs)}</span>
          </div>
        </div>

        <div className="flex items-center gap-6">
          <button 
            onClick={() => stopAndSave(false)} 
            className="w-16 h-16 rounded-2xl bg-white/10 backdrop-blur-md flex items-center justify-center hover:bg-white/20 transition-colors border border-white/10"
            title="Stop & Reschedule Remainder"
          >
            <Square size={24} className="text-rose-400" fill="currentColor" />
          </button>
          
          <button 
            onClick={() => setIsRunning(!isRunning)} 
            className="w-20 h-20 rounded-3xl bg-cyan-500 flex items-center justify-center shadow-[0_0_30px_rgba(6,182,212,0.5)] hover:scale-105 transition-transform"
          >
            {isRunning ? <Pause size={32} fill="currentColor" /> : <Play size={32} fill="currentColor" className="ml-1" />}
          </button>
          
          <button 
            onClick={() => stopAndSave(true)} 
            className="w-16 h-16 rounded-2xl bg-white/10 backdrop-blur-md flex items-center justify-center hover:bg-green-500/20 hover:border-green-500/50 transition-colors border border-white/10"
            title="Mark as Completed"
          >
            <CheckCircle2 size={28} className="text-green-400" />
          </button>
        </div>
        
        <p className="text-xs text-slate-500 mt-10 max-w-[250px] text-center">
          Stopping early will automatically reschedule the unfinished duration to your next available slot.
        </p>

      </div>
    </div>
  );
};