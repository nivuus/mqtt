// src/features/wifi/hostapdEntities.ts
//
// Home Assistant entities of the Wi-Fi feature: what each one is, never how it is sent.

import { SECURITY_TYPES } from './securityProfiles';

export interface EntitySpec {
  component: 'sensor' | 'text' | 'select' | 'button';
  objectId: string;
  payload: Record<string, unknown>;
}

type Topic = (path: string) => string;

export function globalEntities(feature: string, topic: Topic, bridges: string[]): EntitySpec[] {
  const t = (path: string) => topic(`${feature}/${path}`);
  return [
    { component: 'sensor', objectId: 'ssids_summary', payload: {
      name: 'Network WiFi SSIDs Sensor', state_topic: t('ssids_count/state'), icon: 'mdi:wifi',
      entity_category: 'diagnostic', json_attributes_topic: t('ssids_list/attributes') } },
    { component: 'sensor', objectId: 'last_action', payload: {
      name: 'Network WiFi Last Action Sensor', state_topic: t('last_action/state'),
      icon: 'mdi:wifi-sync', entity_category: 'diagnostic' } },
    { component: 'text', objectId: 'new_ssid_input', payload: {
      name: 'Network WiFi New SSID Input', command_topic: t('new_ssid_input/set'),
      state_topic: t('new_ssid_input/state'), icon: 'mdi:wifi', entity_category: 'config', mode: 'text' } },
    { component: 'text', objectId: 'new_password_input', payload: {
      name: 'Network WiFi New Password Input', command_topic: t('new_password_input/set'),
      state_topic: t('new_password_input/state'), icon: 'mdi:key', entity_category: 'config', mode: 'password' } },
    { component: 'select', objectId: 'new_security_select', payload: {
      name: 'Network WiFi New Security Type', command_topic: t('new_security_select/set'),
      state_topic: t('new_security_select/state'), icon: 'mdi:shield-lock', entity_category: 'config',
      options: [...SECURITY_TYPES] } },
    { component: 'select', objectId: 'new_bridge_select', payload: {
      name: 'Network WiFi New Network Bridge', command_topic: t('new_bridge_select/set'),
      state_topic: t('new_bridge_select/state'), icon: 'mdi:lan', entity_category: 'config',
      options: bridges } },
    { component: 'button', objectId: 'add_hotspot_btn', payload: {
      name: 'Network WiFi Add Hotspot Button', command_topic: t('command/add_hotspot'),
      payload_press: 'ADD_HOTSPOT', icon: 'mdi:wifi-plus', entity_category: 'config' } },
    { component: 'button', objectId: 'reload_hostapd_btn', payload: {
      name: 'Network WiFi Reload Hostapd Button', command_topic: t('command/reload_hostapd'),
      payload_press: 'RELOAD_HOSTAPD', icon: 'mdi:reload', entity_category: 'config' } },
  ];
}

export function networkEntities(feature: string, topic: Topic, id: number, ssid: string): EntitySpec[] {
  const t = (path: string) => topic(`${feature}/network_${id}/${path}`);
  const name = (what: string) => `Network WiFi ${ssid} ${what}`;
  return [
    { component: 'text', objectId: `network_${id}_name`, payload: {
      name: name('SSID'), command_topic: t('name/set'), state_topic: t('name/state'),
      icon: 'mdi:wifi', entity_category: 'config', mode: 'text' } },
    { component: 'text', objectId: `network_${id}_password`, payload: {
      name: name('Password'), command_topic: t('password/set'), state_topic: t('password/state'),
      icon: 'mdi:key', entity_category: 'config', mode: 'text' } },
    { component: 'select', objectId: `network_${id}_security`, payload: {
      name: name('Security'), command_topic: t('security/set'), state_topic: t('security/state'),
      icon: 'mdi:shield-lock', entity_category: 'config', options: [...SECURITY_TYPES] } },
    { component: 'button', objectId: `network_${id}_apply`, payload: {
      name: name('Apply'), command_topic: t('command/apply'), payload_press: 'APPLY',
      icon: 'mdi:check-circle', entity_category: 'config' } },
    { component: 'button', objectId: `network_${id}_delete`, payload: {
      name: name('Delete'), command_topic: t('command/delete'), payload_press: 'DELETE',
      icon: 'mdi:delete', entity_category: 'config' } },
    { component: 'sensor', objectId: `network_${id}_status`, payload: {
      name: name('Status'), state_topic: t('status/state'), icon: 'mdi:information',
      entity_category: 'diagnostic' } },
  ];
}

/** 'Active (2.4+5GHz)' and friends, from the files a network appears in. */
export function bandsLabel(configFiles: string[]): string {
  if (configFiles.length > 1) return '2.4+5GHz';
  return configFiles[0]?.includes('5Ghz') ? '5GHz' : '2.4GHz';
}
