import {
  Cloud,
  CloudFog,
  CloudLightning,
  CloudMoon,
  CloudMoonRain,
  CloudRain,
  CloudSnow,
  CloudSun,
  CloudSunRain,
  Moon,
  Sun,
  Wind,
  type LucideIcon,
} from 'lucide-react';
import type { SmartEntity } from '../../core/types';

/** "48°F" from an HA weather entity, or null when it reports no temperature. */
export const temperature = (w: SmartEntity): string | null => {
  const t = w.attributes['temperature'];
  const unit = w.attributes['temperature_unit'];
  return typeof t === 'number' ? `${Math.round(t)}${typeof unit === 'string' ? unit : '°'}` : null;
};

export interface WeatherLook {
  readonly icon: LucideIcon;
  readonly label: string;
}

/** HA weather condition (https://www.home-assistant.io/integrations/weather/) → icon, day or night. */
export const weatherLook = (condition: string, night: boolean): WeatherLook => {
  switch (condition) {
    case 'sunny':
      return night ? { icon: Moon, label: 'Clear' } : { icon: Sun, label: 'Sunny' };
    case 'clear-night':
      return { icon: Moon, label: 'Clear' };
    case 'partlycloudy':
      return { icon: night ? CloudMoon : CloudSun, label: 'Partly cloudy' };
    case 'cloudy':
      return { icon: Cloud, label: 'Cloudy' };
    case 'rainy':
      return { icon: night ? CloudMoonRain : CloudSunRain, label: 'Rain' };
    case 'pouring':
      return { icon: CloudRain, label: 'Heavy rain' };
    case 'lightning':
    case 'lightning-rainy':
      return { icon: CloudLightning, label: 'Thunderstorms' };
    case 'snowy':
    case 'snowy-rainy':
    case 'hail':
      return { icon: CloudSnow, label: condition === 'snowy' ? 'Snow' : condition === 'hail' ? 'Hail' : 'Sleet' };
    case 'fog':
      return { icon: CloudFog, label: 'Fog' };
    case 'windy':
    case 'windy-variant':
      return { icon: Wind, label: 'Windy' };
    default:
      return { icon: night ? Moon : Sun, label: condition.replace(/[-_]/g, ' ') };
  }
};
