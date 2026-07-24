'use client';

import React, { useState, useEffect } from 'react';
import { useUser, useUserSettings } from '../api/useUser';
import { useUpdateUserProfile } from '../api/useUpdateUserProfile';
import { useUpdateUserSettings } from '../api/useUpdateUserSettings';

interface UserProfileFormProps {
  userId: string;
}

export const UserProfileForm = ({ userId }: UserProfileFormProps) => {
  // Read Hooks
  const { data: user, isLoading: isUserLoading, isError: isUserError } = useUser(userId);
  const { data: settings, isLoading: isSettingsLoading } = useUserSettings(userId);

  // Mutation Hooks
  const { mutate: updateProfile, isPending: isUpdatingProfile } = useUpdateUserProfile(userId);
  const { mutate: updateSettings, isPending: isUpdatingSettings } = useUpdateUserSettings(userId);

  // Local Form State for Profile
  const [profileForm, setProfileForm] = useState({
    name: '',
    image: '',
  });

  // Local Form State for Settings
  const [settingsForm, setSettingsForm] = useState({
    theme: 'system' as 'light' | 'dark' | 'system',
    notificationsEnabled: true,
    language: 'en',
  });

  // Sync local state once data is loaded
  useEffect(() => {
    if (user) {
      setProfileForm({
        name: user.name,
        image: user.image || '',
      });
    }
  }, [user]);

  useEffect(() => {
    if (settings) {
      setSettingsForm({
        theme: settings.theme,
        notificationsEnabled: settings.notificationsEnabled,
        language: settings.language,
      });
    }
  }, [settings]);

  const handleProfileSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    updateProfile(profileForm);
  };

  const handleThemeChange = (newTheme: 'light' | 'dark' | 'system') => {
    updateSettings({ theme: newTheme });
  };

  const handleNotificationToggle = (enabled: boolean) => {
    updateSettings({ notificationsEnabled: enabled });
  };

  if (isUserLoading || isSettingsLoading) {
    return <div className="p-8 text-center text-gray-500">Loading profile...</div>;
  }

  if (isUserError) {
    return <div className="p-8 text-center text-red-500">Error loading user data.</div>;
  }

  return (
    <div className="max-w-2xl mx-auto space-y-8 p-6">
      {/* Profile Section */}
      <section className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100">
          <h2 className="text-lg font-semibold text-gray-800">Personal Information</h2>
        </div>
        
        <form onSubmit={handleProfileSubmit} className="p-6 space-y-4">
          <div className="flex items-center space-x-4 mb-6">
            <div className="h-16 w-16 rounded-full bg-gray-200 flex items-center justify-center overflow-hidden">
              {user?.image ? (
                <img src={user.image} alt="Avatar" className="h-full w-full object-cover" />
              ) : (
                <span className="text-gray-500 text-xl font-bold">{user?.name?.charAt(0)}</span>
              )}
            </div>
            <div className="text-sm text-gray-500">
              {user?.email}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Full Name</label>
            <input
              type="text"
              value={profileForm.name}
              onChange={(e) => setProfileForm({ ...profileForm, name: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 outline-none transition-all"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Avatar URL</label>
            <input
              type="text"
              value={profileForm.image}
              onChange={(e) => setProfileForm({ ...profileForm, image: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 outline-none transition-all"
            />
          </div>

          <button
            type="submit"
            disabled={isUpdatingProfile}
            className="w-full bg-blue-600 text-white py-2 rounded-md hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            {isUpdatingProfile ? 'Saving...' : 'Update Profile'}
          </button>
        </form>
      </section>

      {/* Settings Section */}
      <section className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100">
          <h2 className="text-lg font-semibold text-gray-800">Preferences</h2>
        </div>
        
        <div className="p-6 space-y-6">
          {/* Theme Switcher */}
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-800">Appearance</p>
              <p className="text-xs text-gray-500">Choose your preferred color theme</p>
            </div>
            <div className="flex bg-gray-100 p-1 rounded-lg">
              {(['light', 'dark', 'system'] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => handleThemeChange(t)}
                  className={`px-3 py-1 text-xs rounded-md transition-all ${
                    settingsForm.theme === t 
                      ? 'bg-white shadow-sm text-blue-600 font-medium' 
                      : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  {t.charAt(0).toUpperCase() + t.slice(1)}
                </button>
              ))}
            </div>
          </div>

          {/* Notifications Toggle */}
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-800">Email Notifications</p>
              <p className="text-xs text-gray-500">Receive updates about your account</p>
            </div>
            <button
              onClick={() => handleNotificationToggle(!settingsForm.notificationsEnabled)}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${
                settingsForm.notificationsEnabled ? 'bg-blue-600' : 'bg-gray-200'
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  settingsForm.notificationsEnabled ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>

          {/* Language Selector */}
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-800">Language</p>
              <p className="text-xs text-gray-500">Select your preferred language</p>
            </div>
            <select
              value={settingsForm.language}
              onChange={(e) => updateSettings({ language: e.target.value })}
              className="text-sm border-gray-300 rounded-md focus:ring-blue-500 outline-none"
            >
              <option value="en">English</option>
              <option value="es">Spanish</option>
              <option value="fr">French</option>
            </select>
          </div>
        </div>
      </section>
    </div>
  );
};
