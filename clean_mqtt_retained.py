#!/usr/bin/env python3
"""
Clean all retained MQTT messages for Home Assistant discovery and system_agent topics
"""

import paho.mqtt.client as mqtt
import time

MQTT_HOST = "192.168.0.1"
MQTT_PORT = 1883
MQTT_USER = "mqtt"
MQTT_PASS = "CHANGE_ME_MQTT_PASSWORD"

topics_to_clean = []

def on_connect(client, userdata, flags, rc):
    print(f"Connected with result code {rc}")
    # Subscribe to all homeassistant and system_agent topics
    client.subscribe("homeassistant/#")
    client.subscribe("system_agent/#")
    print("Subscribed to homeassistant/# and system_agent/#")

def on_message(client, userdata, msg):
    # Only process retained messages
    if msg.retain:
        topics_to_clean.append(msg.topic)
        print(f"Found retained: {msg.topic}")

# Create MQTT client
client = mqtt.Client()
client.username_pw_set(MQTT_USER, MQTT_PASS)
client.on_connect = on_connect
client.on_message = on_message

# Connect and collect retained messages
print("Connecting to MQTT broker...")
client.connect(MQTT_HOST, MQTT_PORT, 60)

# Run for 5 seconds to collect all retained messages
print("Collecting retained messages for 5 seconds...")
client.loop_start()
time.sleep(5)
client.loop_stop()

# Now delete all collected topics
print(f"\nFound {len(topics_to_clean)} retained messages to clean")

if topics_to_clean:
    print("\nDeleting retained messages...")
    for topic in topics_to_clean:
        client.publish(topic, None, retain=True)
        print(f"Deleted: {topic}")

    print(f"\nSuccessfully deleted {len(topics_to_clean)} retained messages")
else:
    print("No retained messages found to clean")

client.disconnect()
