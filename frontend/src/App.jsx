import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { SocketProvider } from './context/SocketContext';
import { Navbar } from './components/Navbar';
import { ProblemList } from './pages/ProblemList';
import { ProblemDetail } from './pages/ProblemDetail';
import { Login } from './pages/Login';
import { Register } from './pages/Register';
import { CreateProblem } from './pages/CreateProblem';
import { ContestList } from './pages/ContestList';
import { ContestArena } from './pages/ContestArena';
import { CreateContest } from './pages/CreateContest';

function App() {
  return (
    <AuthProvider>
      <SocketProvider>
        <Router>
          <div className="app-shell">
          <Navbar />
          <main className="main-content">
            <Routes>
              <Route path="/" element={<Navigate to="/problems" replace />} />
              <Route path="/problems" element={<ProblemList />} />
              <Route path="/problems/:slug" element={<ProblemDetail />} />
              <Route path="/login" element={<Login />} />
              <Route path="/register" element={<Register />} />
              <Route path="/admin/create-problem" element={<CreateProblem />} />
              <Route path="/admin/create-contest" element={<CreateContest />} />
              <Route path="/contests" element={<ContestList />} />
              <Route path="/contests/:id" element={<ContestArena />} />
              <Route path="*" element={<Navigate to="/problems" replace />} />
            </Routes>
          </main>
        </div>
      </Router>
      </SocketProvider>
    </AuthProvider>
  );
}

export default App;
