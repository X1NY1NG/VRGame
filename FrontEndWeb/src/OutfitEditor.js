import React from 'react';
import { AvatarCreator } from '@readyplayerme/react-avatar-creator';

export default function OutfitEditor({ subdomain, avatarId, onDone }) {
  const config = {
    clearCache: true,
    bodyType: 'fullbody',
    avatarId: avatarId,   // pre-loads the existing avatar
  };

  return (
    <div style={{ width: '100%', height: '85vh' }}>
      <AvatarCreator
        subdomain={subdomain}
        config={config}
        style={{ width: '100%', height: '100%', border: 'none' }}
        onAvatarExported={(e) => onDone(e.data)}  // fires when user clicks Done
      />
    </div>
  );
}
