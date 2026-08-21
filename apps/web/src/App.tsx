import { Route, Routes } from "react-router-dom";
import { Layout } from "./components/Layout";
import { AccessPage } from "./pages/AccessPage";
import { DirectoryPage } from "./pages/DirectoryPage";
import { HomePage } from "./pages/HomePage";
import { RoomPage } from "./pages/RoomPage";
import { StudioPage } from "./pages/StudioPage";
import { TrustCenterPage } from "./pages/TrustCenterPage";

export function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/rooms" element={<DirectoryPage />} />
        <Route path="/rooms/:roomId" element={<RoomPage />} />
        <Route path="/studio" element={<StudioPage />} />
        <Route path="/access" element={<AccessPage />} />
        <Route path="/trust" element={<TrustCenterPage />} />
        <Route path="*" element={<HomePage />} />
      </Routes>
    </Layout>
  );
}
