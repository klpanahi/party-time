import { BrowserRouter, Routes, Route } from 'react-router-dom'
import InvitePage from './pages/InvitePage'
import NotFound from './pages/NotFound'
import './App.css'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/invite/:id" element={<InvitePage />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </BrowserRouter>
  )
}
