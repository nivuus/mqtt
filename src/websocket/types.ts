// src/websocket/types.ts

/**
 * WebSocket message types for the Wizard API
 */

// Command types
export type CommandType = 'action' | 'query' | 'subscribe' | 'unsubscribe';

// Feature names supported by the wizard
export type FeatureName =
  | 'network'
  | 'firewall'
  | 'wifi'
  | 'pppoe'
  | 'vm'
  | 'system'
  | 'wizard';

// Actions per feature
export interface FeatureActions {
  network: 'get_interfaces' | 'get_zones' | 'set_interface_zone' | 'get_status';
  firewall: 'get_rules' | 'add_port' | 'remove_port' | 'add_forward' | 'remove_forward' | 'get_zone_details' | 'list_zones';
  wifi: 'get_networks' | 'add_network' | 'delete_network' | 'update_network' | 'reload';
  pppoe: 'get_credentials' | 'set_credentials' | 'test_connection' | 'restart';
  vm: 'list_vms' | 'start_vm' | 'stop_vm' | 'restart_vm' | 'get_state';
  system: 'check_updates' | 'apply_updates' | 'get_status' | 'get_info';
  wizard: 'get_state' | 'set_step' | 'complete' | 'reset';
}

/**
 * Command sent from client to server
 */
export interface WizardCommand {
  id: string;                    // UUID for tracking
  type: CommandType;
  feature: FeatureName;
  action: string;
  params?: Record<string, unknown>;
  token?: string;                // Auth token (optional if already authenticated)
}

/**
 * Response sent from server to client
 */
export interface WizardResponse {
  id: string;                    // Same UUID as the command
  success: boolean;
  data?: unknown;
  error?: string;
  progress?: number;             // 0-100 for long-running actions
}

/**
 * Event pushed from server to client (for subscriptions)
 */
export interface WizardEvent {
  type: 'event';
  feature: FeatureName;
  event: string;
  data: unknown;
  timestamp: number;
}

/**
 * Authentication message
 */
export interface AuthMessage {
  type: 'auth';
  token: string;
}

/**
 * Authentication response
 */
export interface AuthResponse {
  type: 'auth_result';
  success: boolean;
  error?: string;
}

/**
 * WebSocket configuration
 */
export interface WebSocketConfig {
  enabled: boolean;
  port: number;
  host: string;
  auth: {
    type: 'token' | 'none';
    token?: string;
  };
  ssl?: {
    enabled: boolean;
    cert?: string;
    key?: string;
  };
}

/**
 * Connected client info
 */
export interface ConnectedClient {
  id: string;
  authenticated: boolean;
  connectedAt: Date;
  lastActivity: Date;
  subscriptions: Set<string>;
}

/**
 * Handler function type for feature actions
 */
export type ActionHandler = (params: Record<string, unknown>) => Promise<unknown>;

/**
 * Feature handler registry
 */
export interface FeatureHandlers {
  [action: string]: ActionHandler;
}
