import { BrowserRouter, Routes, Route } from 'react-router-dom'
import EventSummary from './pages/EventSummary'
import EventDetails from './pages/EventDetails'
import './App.css'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<EventSummary />} />
        <Route path="/event/:id" element={<EventDetails />} />
      </Routes>
    </BrowserRouter>
  )
}
