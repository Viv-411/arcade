import { Route, Routes } from "react-router-dom";
import Home from "./pages/Home";
import MindMeldPage from "./pages/MindMeldPage";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/mindmeld" element={<MindMeldPage />} />
      <Route path="*" element={<Home />} />
    </Routes>
  );
}
