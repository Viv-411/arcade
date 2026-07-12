import { Route, Routes } from "react-router-dom";
import Home from "./pages/Home";
import MindMeldPage from "./pages/MindMeldPage";
import TriviaPage from "./pages/TriviaPage";
import BidBattlePage from "./pages/BidBattlePage";
import AccountPage from "./pages/AccountPage";
import FriendsPage from "./pages/FriendsPage";
import { AuthProvider } from "./auth/AuthContext";
import AuthButton from "./auth/AuthButton";
import { SocialProvider } from "./social/SocialContext";
import NotificationBell from "./social/NotificationBell";

export default function App() {
  return (
    <AuthProvider>
      <SocialProvider>
        <div className="corner-buttons">
          <NotificationBell />
          <AuthButton />
        </div>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/mindmeld" element={<MindMeldPage />} />
          <Route path="/trivia" element={<TriviaPage />} />
          <Route path="/bidbattle" element={<BidBattlePage />} />
          <Route path="/account" element={<AccountPage />} />
          <Route path="/friends" element={<FriendsPage />} />
          <Route path="*" element={<Home />} />
        </Routes>
      </SocialProvider>
    </AuthProvider>
  );
}
