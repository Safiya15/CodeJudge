import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useSocket } from '../context/SocketContext';
import { Code2, Trophy, PlusCircle, LogIn, LogOut, User } from 'lucide-react';

export const Navbar = () => {
  const { user, logout, isAdmin } = useAuth();
  const { isConnected } = useSocket();
  const navigate = useNavigate();

  return (
    <nav className="navbar">
      <div className="nav-container">
        <div className="nav-brand">
          <Link to="/" className="brand-logo">
            <Code2 className="brand-icon" />
            <span>CodeJudge</span>
          </Link>
          <div className="nav-links">
            <Link to="/problems" className="nav-link">
              Problems
            </Link>
            <Link to="/contests" className="nav-link">
              <Trophy className="nav-icon-sm" />
              Contests
            </Link>
          </div>
        </div>

        <div className="nav-actions">
          {user ? (
            <div className="user-menu">
              {/* Real-time WebSocket connection indicator */}
              <div
                className={`ws-indicator ${isConnected ? 'ws-connected' : 'ws-disconnected'}`}
                title={isConnected ? 'Live WebSocket connection active' : 'Reconnecting to live server...'}
              >
                <span className="ws-dot"></span>
                <span className="ws-text">{isConnected ? 'Live' : 'Offline'}</span>
              </div>

              {isAdmin && (
                <Link to="/admin/create-problem" className="btn btn-secondary btn-sm">
                  <PlusCircle size={16} />
                  <span>New Problem</span>
                </Link>
              )}
              <div className="user-badge">
                <User size={16} />
                <span>{user.name}</span>
                <span className={`role-pill role-${user.role}`}>{user.role}</span>
              </div>
              <button onClick={() => { logout(); navigate('/login'); }} className="btn btn-ghost btn-sm" title="Log out">
                <LogOut size={16} />
                <span>Logout</span>
              </button>
            </div>
          ) : (
            <div className="auth-buttons">
              <Link to="/login" className="btn btn-ghost btn-sm">
                <LogIn size={16} />
                <span>Login</span>
              </Link>
              <Link to="/register" className="btn btn-primary btn-sm">
                Sign Up
              </Link>
            </div>
          )}
        </div>
      </div>
    </nav>
  );
};
