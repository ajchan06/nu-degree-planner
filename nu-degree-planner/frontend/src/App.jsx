import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import Onboarding from './pages/Onboarding'
import Plan from './pages/Plan'

function RootRedirect() {
  const savedId = localStorage.getItem('studentId')
  return savedId ? <Navigate to={`/plan/${savedId}`} /> : <Navigate to="/onboarding" />
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<RootRedirect />} />
        <Route path="/onboarding" element={<Onboarding />} />
        <Route path="/plan/:studentId" element={<Plan />} />
      </Routes>
    </BrowserRouter>
  )
}