import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import Header from './components/Header';
import AlertBanners from './components/AlertBanners';
import EmergencyOverlay from './components/EmergencyOverlay';
import SimDrawer from './components/SimDrawer';
import LiveOps from './pages/LiveOps';
import Payments from './pages/Payments';
import Audit from './pages/Audit';
import Scoreboard from './pages/Scoreboard';
import Report from './pages/Report';
import Verify from './pages/Verify';

export default function App() {
  const { pathname } = useLocation();
  const isPublic = pathname.startsWith('/verify');
  return (
    <div className="min-h-screen">
      <Header compact={isPublic} />
      {!isPublic && <AlertBanners />}
      <main>
        <Routes>
          <Route path="/" element={<LiveOps />} />
          <Route path="/payments" element={<Payments />} />
          <Route path="/audit" element={<Audit />} />
          <Route path="/scoreboard" element={<Scoreboard />} />
          <Route path="/report/:id" element={<Report />} />
          <Route path="/verify" element={<Verify />} />
          <Route path="/verify/:id" element={<Verify />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
      {!isPublic && <EmergencyOverlay />}
      <SimDrawer />
    </div>
  );
}
