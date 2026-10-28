import React, { useEffect, useState } from 'react';
import { AppProvider, useApp } from './context/AppContext';
import { Header } from './components/Header';
import { TabBar } from './components/TabBar';
import { Toast } from './components/Toast';
import { OverlayModal } from './components/OverlayModal';
import { HomeScreen } from './screens/HomeScreen';
import { MedsScreen } from './screens/MedsScreen';
import { SafetyScreen } from './screens/SafetyScreen';
import { HealthScreen } from './screens/HealthScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { AuthScreen } from './screens/AuthScreen';
import { OnboardingScreen } from './screens/OnboardingScreen';

const MainApp: React.FC = () => {
  const { activeTab, authView, onboardingStep, speak } = useApp();
  const [splashVisible, setSplashVisible] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => {
      setSplashVisible(false);
    }, 450);
    return () => clearTimeout(timer);
  }, []);

  // Global click delegate for accessible screen reading on tap/click
  useEffect(() => {
    const handleGlobalClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      const clickable = target.closest('button, a, label.check, summary, [data-say]') as HTMLElement | null;
      if (!clickable || (clickable as any).disabled) return;

      const explicitSay = clickable.dataset.say;
      if (explicitSay !== undefined && explicitSay !== '') {
        speak(explicitSay);
      } else if (clickable.getAttribute('aria-label')) {
        speak(clickable.getAttribute('aria-label') || '');
      }
    };

    document.addEventListener('click', handleGlobalClick, true);
    return () => {
      document.removeEventListener('click', handleGlobalClick, true);
    };
  }, [speak]);

  return (
    <>
      {/* Splash logo during initial boot */}
      {splashVisible && (
        <div className="splash" id="splash" aria-hidden="true">
          <span className="splash-logo">
            <span className="ms fill">spa</span>
          </span>
          <span className="splash-name">GoCare</span>
        </div>
      )}

      {/* Auth Screen Modal */}
      {authView && <AuthScreen />}

      {/* Onboarding walkthrough */}
      {onboardingStep !== null && <OnboardingScreen />}

      {/* App Shell */}
      <Header />

      <main id="main">
        {activeTab === 'home' && <HomeScreen />}
        {activeTab === 'meds' && <MedsScreen />}
        {activeTab === 'safety' && <SafetyScreen />}
        {activeTab === 'health' && <HealthScreen />}
        {activeTab === 'settings' && <SettingsScreen />}
      </main>

      <TabBar />
      <OverlayModal />
      <Toast />
    </>
  );
};

export const App: React.FC = () => {
  return (
    <AppProvider>
      <MainApp />
    </AppProvider>
  );
};

export default App;
