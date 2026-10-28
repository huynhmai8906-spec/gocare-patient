import React from 'react';
import { useApp } from '../context/AppContext';
import { TabScreen } from '../types';

export const TabBar: React.FC = () => {
  const { activeTab, setActiveTab, speak } = useApp();

  const tabs: { key: TabScreen; label: string; icon: string }[] = [
    { key: 'home', label: 'Trang chủ', icon: 'home' },
    { key: 'meds', label: 'Thuốc', icon: 'medication' },
    { key: 'safety', label: 'An toàn', icon: 'shield' },
    { key: 'health', label: 'Sức khỏe', icon: 'monitoring' },
    { key: 'settings', label: 'Hồ sơ', icon: 'person' },
  ];

  const handleTabClick = (tab: TabScreen, label: string) => {
    setActiveTab(tab);
    speak(label);
    if (typeof window !== 'undefined') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const activeIndex = tabs.findIndex(t => t.key === activeTab);

  return (
    <nav className="tabbar" style={{ ['--tab' as any]: Math.max(0, activeIndex) }}>
      {tabs.map(t => (
        <button
          key={t.key}
          className={activeTab === t.key ? 'active' : ''}
          onClick={() => handleTabClick(t.key, t.label)}
          aria-label={t.label}
        >
          <span className="ms" aria-hidden="true">{t.icon}</span>
          {t.label}
        </button>
      ))}
    </nav>
  );
};
