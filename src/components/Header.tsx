import React, { useState, useEffect } from 'react';
import { useApp } from '../context/AppContext';
import { getGreeting, getInitials, spokenTime, spokenDate, spokenHM, getNextDose } from '../utils/helpers';

export const Header: React.FC = () => {
  const { state, speak, isSpeaking, toggleVoice, setActiveTab } = useApp();
  const [greeting, setGreeting] = useState(() => getGreeting());

  useEffect(() => {
    const timer = setInterval(() => {
      setGreeting(getGreeting());
    }, 60000);
    return () => clearInterval(timer);
  }, []);

  const name = state.profile.name || 'GoCare';
  const avatarChar = getInitials(name);

  const handleGreetingClick = () => {
    const now = new Date();
    const next = getNextDose(state.meds, state.log);
    const medText = next
      ? `Thuốc kế tiếp là ${next.med.name}, ${next.med.dose}, lúc ${spokenHM(next.time)}.`
      : 'Hôm nay bạn đã uống đủ thuốc rồi.';
    const text = `${greeting.text} ${name}. Bây giờ là ${spokenTime(now)}, ${spokenDate(now)}. ${medText}`;
    speak(text);
  };

  const handleAvatarClick = () => {
    speak('Hồ sơ của tôi');
    setActiveTab('settings');
  };

  return (
    <header className="topbar">
      <button className="greet" onClick={handleGreetingClick} aria-label="Chào hỏi">
        <span className="greet-eyebrow">{greeting.eyebrow},</span>
        <span className="greet-name">{name}</span>
      </button>

      <button
        className="voice-toggle"
        onClick={toggleVoice}
        aria-pressed={state.voice.on}
        aria-label={state.voice.on ? 'Tắt đọc to' : 'Bật đọc to'}
      >
        <span className="ms fill vt-icon" aria-hidden="true">
          {state.voice.on ? 'volume_up' : 'volume_off'}
        </span>
        <span className="waves" aria-hidden="true" style={{ display: isSpeaking ? 'flex' : 'none' }}>
          <i></i>
          <i></i>
          <i></i>
          <i></i>
        </span>
      </button>

      <button className="avatar" onClick={handleAvatarClick} aria-label="Hồ sơ của tôi">
        <span>{avatarChar}</span>
      </button>
    </header>
  );
};
