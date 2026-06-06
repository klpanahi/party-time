import { BrowserRouter, Routes, Route, NavLink } from 'react-router-dom'
import EventSummary from './pages/EventSummary'
import EventDetails from './pages/EventDetails'
import Contacts from './pages/Contacts'
import './App.css'

function Nav() {
  return (
    <nav className="top-nav">
      <span className="nav-brand">Party Time</span>
      <div className="nav-links">
        <NavLink to="/" end className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}>
          Events
        </NavLink>
        <NavLink to="/contacts" className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}>
          Contacts
        </NavLink>
      </div>
    </nav>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <Nav />
      <Routes>
        <Route path="/" element={<EventSummary />} />
        <Route path="/event/:id" element={<EventDetails />} />
        <Route path="/contacts" element={<Contacts />} />
      </Routes>
    </BrowserRouter>
  )
}
