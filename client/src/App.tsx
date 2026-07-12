import { Route, Routes } from "react-router-dom";
import Home from "./pages/Home";
import MindMeldPage from "./pages/MindMeldPage";
import TriviaPage from "./pages/TriviaPage";
import BidBattlePage from "./pages/BidBattlePage";
import AccountPage from "./pages/AccountPage";
import { AuthProvider } from "./auth/AuthContext";
import AuthButton from "./auth/AuthButton";

export default function App() {
  return (
    <AuthProvider>
      <AuthButton />
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/mindmeld" element={<MindMeldPage />} />
        <Route path="/trivia" element={<TriviaPage />} />
        <Route path="/bidbattle" element={<BidBattlePage />} />
        <Route path="/account" element={<AccountPage />} />
        <Route path="*" element={<Home />} />
      </Routes>
    </AuthProvider>
  );
}
