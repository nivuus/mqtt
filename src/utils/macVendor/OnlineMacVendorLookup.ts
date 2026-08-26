// src/utils/macVendor/OnlineMacVendorLookup.ts

import fs from 'fs/promises';
import https from 'https';
import path from 'path';
import { URL } from 'url';
import logger from '../logger';

export interface MacVendorInfo {
  vendor?: string;
  model?: string;
}

interface CacheEntry {
  vendor: string;
  timestamp: number;
}

interface CacheData {
  [oui: string]: CacheEntry;
}

/**
 * Online MAC vendor lookup with caching
 * Uses multiple sources for vendor information
 */
export class OnlineMacVendorLookup {
  private static readonly CACHE_FILE = path.join(process.cwd(), 'cache', 'mac-vendors.json');
  private static readonly CACHE_DURATION = 7 * 24 * 60 * 60 * 1000; // 7 days
  private static readonly API_ENDPOINTS = [
    'https://api.macvendors.com',
    'https://macvendors.co/api'
  ];
  
  private static cache: CacheData = {};
  private static initialized = false;

  /**
   * Initialize the cache system
   */
  private static async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      // Ensure cache directory exists
      const cacheDir = path.dirname(this.CACHE_FILE);
      await fs.mkdir(cacheDir, { recursive: true });

      // Load existing cache
      await this.loadCache();
      this.initialized = true;
    } catch (error) {
      logger.warn('Failed to initialize MAC vendor cache:', error);
      this.initialized = true; // Continue without cache
    }
  }

  /**
   * Load cache from file
   */
  private static async loadCache(): Promise<void> {
    try {
      const data = await fs.readFile(this.CACHE_FILE, 'utf-8');
      this.cache = JSON.parse(data);
      logger.debug(`Loaded ${Object.keys(this.cache).length} entries from MAC vendor cache`);
    } catch (error) {
      // Cache file doesn't exist or is corrupted, start fresh
      this.cache = {};
    }
  }

  /**
   * Save cache to file
   */
  private static async saveCache(): Promise<void> {
    try {
      await fs.writeFile(this.CACHE_FILE, JSON.stringify(this.cache, null, 2));
    } catch (error) {
      logger.warn('Failed to save MAC vendor cache:', error);
    }
  }

  /**
   * Extract OUI (first 3 octets) from MAC address
   */
  private static extractOUI(macAddress: string): string {
    const normalized = macAddress.toLowerCase().replace(/[^0-9a-f]/g, '');
    if (normalized.length < 6) return '';
    
    // Format as xx:xx:xx
    return [
      normalized.substring(0, 2),
      normalized.substring(2, 4), 
      normalized.substring(4, 6)
    ].join(':');
  }

  /**
   * Check if cache entry is still valid
   */
  private static isCacheValid(entry: CacheEntry): boolean {
    return (Date.now() - entry.timestamp) < this.CACHE_DURATION;
  }

  /**
   * Fetch vendor from online API
   */
  private static async fetchFromAPI(macAddress: string): Promise<string | null> {
    for (const endpoint of this.API_ENDPOINTS) {
      try {
        const data = await this.httpGet(`${endpoint}/${macAddress}`);

        if (data) {
          const text = typeof data === 'string' ? data : JSON.stringify(data);
          
          // Handle different response formats
          if (text && !text.includes('Not Found') && !text.includes('error')) {
            // Some APIs return JSON, others plain text
            try {
              const json = JSON.parse(text);
              return json.company || json.vendor || json.result?.company || null;
            } catch {
              // Plain text response
              return text.trim();
            }
          }
        }
        
        // Small delay between attempts
        await new Promise(resolve => setTimeout(resolve, 1000));
      } catch (error: any) {
        logger.debug(`Failed to fetch from ${endpoint}:`, error.message);
        continue;
      }
    }
    
    return null;
  }

  /**
   * Simple HTTP GET request using native https module
   */
  private static async httpGet(url: string): Promise<string | null> {
    return new Promise((resolve, reject) => {
      const parsedUrl = new URL(url);
      
      const options = {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || 443,
        path: parsedUrl.pathname + parsedUrl.search,
        method: 'GET',
        timeout: 5000,
        headers: {
          'User-Agent': 'mqtt-system-agent/1.0'
        }
      };

      const req = https.request(options, (res) => {
        if (res.statusCode === 429) {
          // Rate limited, reject to trigger retry delay
          reject(new Error('Rate limited'));
          return;
        }

        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }

        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });

        res.on('end', () => {
          resolve(data);
        });
      });

      req.on('error', (err) => {
        reject(err);
      });

      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Request timeout'));
      });

      req.end();
    });
  }

  /**
   * Lookup vendor information for a MAC address
   */
  static async lookupVendor(macAddress: string): Promise<MacVendorInfo> {
    if (!macAddress) return {};

    await this.initialize();
    
    const oui = this.extractOUI(macAddress);
    if (!oui) return {};

    // Check cache first
    const cached = this.cache[oui];
    if (cached && this.isCacheValid(cached)) {
      return { vendor: cached.vendor };
    }

    // Fetch from online API
    try {
      const vendor = await this.fetchFromAPI(macAddress);
      
      if (vendor) {
        // Update cache
        this.cache[oui] = {
          vendor,
          timestamp: Date.now()
        };
        
        // Save cache asynchronously
        this.saveCache().catch(err => 
          logger.warn('Failed to save cache after lookup:', err)
        );
        
        return { vendor };
      }
    } catch (error) {
      logger.debug('Online lookup failed:', error);
    }

    return {};
  }

  /**
   * Batch lookup for multiple MAC addresses
   */
  static async batchLookup(macAddresses: string[]): Promise<Map<string, MacVendorInfo>> {
    const results = new Map<string, MacVendorInfo>();
    
    // Process in small batches to avoid rate limiting
    const batchSize = 5;
    for (let i = 0; i < macAddresses.length; i += batchSize) {
      const batch = macAddresses.slice(i, i + batchSize);
      
      const promises = batch.map(async (mac) => {
        const result = await this.lookupVendor(mac);
        results.set(mac, result);
      });
      
      await Promise.all(promises);
      
      // Small delay between batches
      if (i + batchSize < macAddresses.length) {
        await new Promise(resolve => setTimeout(resolve, 200));
      }
    }
    
    return results;
  }

  /**
   * Clear expired entries from cache
   */
  static async cleanCache(): Promise<void> {
    await this.initialize();
    
    const now = Date.now();
    let cleaned = 0;
    
    for (const [oui, entry] of Object.entries(this.cache)) {
      if ((now - entry.timestamp) > this.CACHE_DURATION) {
        delete this.cache[oui];
        cleaned++;
      }
    }
    
    if (cleaned > 0) {
      await this.saveCache();
      logger.info(`Cleaned ${cleaned} expired entries from MAC vendor cache`);
    }
  }

  /**
   * Get cache statistics
   */
  static async getCacheStats(): Promise<{
    entries: number;
    validEntries: number;
    expiredEntries: number;
  }> {
    await this.initialize();
    
    const now = Date.now();
    let validEntries = 0;
    let expiredEntries = 0;
    
    for (const entry of Object.values(this.cache)) {
      if ((now - entry.timestamp) < this.CACHE_DURATION) {
        validEntries++;
      } else {
        expiredEntries++;
      }
    }
    
    return {
      entries: Object.keys(this.cache).length,
      validEntries,
      expiredEntries
    };
  }
}
