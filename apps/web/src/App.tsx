import { Route, Routes } from "react-router-dom";
import { Layout } from "./components/Layout";
import { AccessPage } from "./pages/AccessPage";
import { DirectoryPage } from "./pages/DirectoryPage";
import { EvidencePage } from "./pages/EvidencePage";
import { HomePage } from "./pages/HomePage";
import { RoomPage } from "./pages/RoomPage";
import { SecurityPage } from "./pages/SecurityPage";
import { StudioPage } from "./pages/StudioPage";

export function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/rooms" element={<DirectoryPage />} />
        <Route path="/rooms/:roomId" element={<RoomPage />} />
        <Route path="/studio" element={<StudioPage />} />
        <Route path="/access" element={<AccessPage />} />
        <Route path="/evidence" element={<EvidencePage />} />
        <Route path="/security" element={<SecurityPage />} />
        <Route path="*" element={<HomePage />} />
      </Routes>
    </Layout>
  );
}
