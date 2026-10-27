import { Outlet, Route, Routes } from "react-router-dom";
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
import {
  ChessChoicePage,
  ChessLocalPage,
  ChessOnlinePage,
  ChessRouteFrame,
} from "./chess/lazyChess";
import { HotlapHubPage, HotlapPlayPage, HotlapRouteFrame } from "./hotlap/lazyHotlap";

// Chess and Hotlap are code-split route groups (heavy libraries); see
// chess/lazyChess and hotlap/lazyHotlap for how stale chunks are handled.
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
          {/* One Suspense + error boundary for the whole group, so moving
              between the chess pages never re-shows a loading state. */}
          <Route
            element={
              <ChessRouteFrame>
                <Outlet />
              </ChessRouteFrame>
            }
          >
            <Route path="/chess" element={<ChessChoicePage />} />
            <Route path="/chess/online" element={<ChessOnlinePage />} />
            <Route path="/chess/local" element={<ChessLocalPage />} />
          </Route>
          <Route
            element={
              <HotlapRouteFrame>
                <Outlet />
              </HotlapRouteFrame>
            }
          >
            <Route path="/hotlap" element={<HotlapHubPage />} />
            <Route path="/hotlap/:trackId" element={<HotlapPlayPage />} />
          </Route>
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
