import { Route, Routes } from "react-router-dom";
import Home from "./pages/Home";
import MindMeldPage from "./pages/MindMeldPage";
import TriviaPage from "./pages/TriviaPage";
import BidBattlePage from "./pages/BidBattlePage";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/mindmeld" element={<MindMeldPage />} />
      <Route path="/trivia" element={<TriviaPage />} />
      <Route path="/bidbattle" element={<BidBattlePage />} />
      <Route path="*" element={<Home />} />
    </Routes>
  );
}
