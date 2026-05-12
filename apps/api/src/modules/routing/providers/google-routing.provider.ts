import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { RouteLeg, RoutingProvider } from '../routing-provider.interface';
import { haversineKm } from '@smartfleet/shared-utils';

@Injectable()
export class GoogleRoutingProvider implements RoutingProvider {
  private logger = new Logger('GoogleRouting');
  private apiKey: string;

  constructor(cfg: ConfigService) {
    this.apiKey = cfg.get<string>('routing.googleKey') ?? '';
  }

  async matrix(
    origins: { lat: number; lng: number }[],
    destinations: { lat: number; lng: number }[],
  ): Promise<RouteLeg[][]> {
    if (!this.apiKey) {
      // Fallback to haversine for local dev when no key configured
      return origins.map((o) =>
        destinations.map((d) => {
          const km = haversineKm(o, d);
          return { distanceKm: km, durationSec: Math.round((km / 30) * 3600) }; // 30km/h assumption
        }),
      );
    }
    const o = origins.map((p) => `${p.lat},${p.lng}`).join('|');
    const d = destinations.map((p) => `${p.lat},${p.lng}`).join('|');
    const url = `https://maps.googleapis.com/maps/api/distancematrix/json?origins=${o}&destinations=${d}&key=${this.apiKey}`;
    const { data } = await axios.get(url);
    return data.rows.map((row: any) =>
      row.elements.map((e: any) => ({
        distanceKm: (e.distance?.value ?? 0) / 1000,
        durationSec: e.duration?.value ?? 0,
      })),
    );
  }

  async route(waypoints: { lat: number; lng: number }[]) {
    if (waypoints.length < 2) return { distanceKm: 0, durationSec: 0 };
    if (!this.apiKey) {
      let km = 0;
      for (let i = 1; i < waypoints.length; i++) km += haversineKm(waypoints[i - 1], waypoints[i]);
      return { distanceKm: km, durationSec: Math.round((km / 30) * 3600) };
    }
    const origin = `${waypoints[0].lat},${waypoints[0].lng}`;
    const dest = `${waypoints[waypoints.length - 1].lat},${waypoints[waypoints.length - 1].lng}`;
    const mid = waypoints
      .slice(1, -1)
      .map((p) => `${p.lat},${p.lng}`)
      .join('|');
    const url =
      `https://maps.googleapis.com/maps/api/directions/json` +
      `?origin=${origin}&destination=${dest}` +
      (mid ? `&waypoints=${mid}` : '') +
      `&key=${this.apiKey}`;
    const { data } = await axios.get(url);
    const route = data.routes?.[0];
    if (!route) return { distanceKm: 0, durationSec: 0 };
    const km = route.legs.reduce((s: number, l: any) => s + l.distance.value, 0) / 1000;
    const sec = route.legs.reduce((s: number, l: any) => s + l.duration.value, 0);
    return { distanceKm: km, durationSec: sec, polyline: route.overview_polyline?.points };
  }
}
