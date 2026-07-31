import { Suspense, lazy } from "react";
import { Route, Routes } from "react-router-dom";
import Home from "./pages/Home";
import MindMeldPage from "./pages/MindMeldPage";
import TriviaPage from "./pages/TriviaPage";
import BidBattlePage from "./pages/BidBattlePage";
import AccountPage from "./pages/AccountPage";
import FriendsPage from "./pages/FriendsPage";
import MessagesPage from "./pages/MessagesPage";
import SetsPage from "./pages/SetsPage";
import SoloTriviaPage from "./pages/SoloTriviaPage";
import ImposterChoicePage from "./pages/ImposterChoicePage";
import ImposterLocalPage from "./pages/ImposterLocalPage";
import ImposterOnlinePage from "./pages/ImposterOnlinePage";
import CodewordsChoicePage from "./pages/CodewordsChoicePage";
import CodewordsRemotePage from "./pages/CodewordsRemotePage";
import CodewordsBoardPage from "./pages/CodewordsBoardPage";
import CodewordsKeyPage from "./pages/CodewordsKeyPage";
import { AuthProvider } from "./auth/AuthContext";
import AuthButton from "./auth/AuthButton";
import { SocialProvider } from "./social/SocialContext";
import NotificationBell from "./social/NotificationBell";

// Chess pulls in chess.js + react-chessboard (~200 kB), which nobody playing
// the other five games should have to download. These three routes are the
// ONLY lazy ones — everything above stays eagerly bundled as before.
const ChessChoicePage = lazy(() => import("./pages/ChessChoicePage"));
const ChessOnlinePage = lazy(() => import("./pages/ChessOnlinePage"));
const ChessLocalPage = lazy(() => import("./pages/ChessLocalPage"));

function PageLoading() {
  return (
    <div className="page">
      <div className="panel" style={{ textAlign: "center" }}>
        <div className="spinner" />
        <p>Loading…</p>
      </div>
    </div>
  );
}

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
          <Route path="/imposter" element={<ImposterChoicePage />} />
          <Route path="/imposter/local" element={<ImposterLocalPage />} />
          <Route path="/imposter-online" element={<ImposterOnlinePage />} />
          <Route path="/codewords" element={<CodewordsChoicePage />} />
          <Route path="/codewords/remote" element={<CodewordsRemotePage />} />
          <Route path="/codewords/board" element={<CodewordsBoardPage />} />
          <Route path="/codewords/key" element={<CodewordsKeyPage />} />
          <Route
            path="/chess"
            element={
              <Suspense fallback={<PageLoading />}>
                <ChessChoicePage />
              </Suspense>
            }
          />
          <Route
            path="/chess/online"
            element={
              <Suspense fallback={<PageLoading />}>
                <ChessOnlinePage />
              </Suspense>
            }
          />
          <Route
            path="/chess/local"
            element={
              <Suspense fallback={<PageLoading />}>
                <ChessLocalPage />
              </Suspense>
            }
          />
          <Route path="/account" element={<AccountPage />} />
          <Route path="/friends" element={<FriendsPage />} />
          <Route path="/messages" element={<MessagesPage />} />
          <Route path="/sets" element={<SetsPage />} />
          <Route path="/solo/trivia" element={<SoloTriviaPage />} />
          <Route path="*" element={<Home />} />
        </Routes>
      </SocialProvider>
    </AuthProvider>
  );
}
