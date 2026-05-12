import { Logger } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { DriversService } from './drivers.service';

@WebSocketGateway({ namespace: '/drivers', cors: true })
export class DriversGateway {
  @WebSocketServer() server!: Server;
  private logger = new Logger('DriversGateway');

  constructor(private readonly drivers: DriversService) {}

  @SubscribeMessage('location:update')
  async onLocation(
    @ConnectedSocket() socket: Socket,
    @MessageBody() data: { driverId: string; lat: number; lng: number },
  ) {
    await this.drivers.updateLocation(data.driverId, data.lat, data.lng);
    // Broadcast for dispatcher map view
    this.server.emit('driver:location', {
      driverId: data.driverId,
      lat: data.lat,
      lng: data.lng,
      at: new Date().toISOString(),
    });
    return { ok: true };
  }

  @SubscribeMessage('online:set')
  async setOnline(@MessageBody() data: { driverId: string; isOnline: boolean }) {
    await this.drivers.setOnline(data.driverId, data.isOnline);
    return { ok: true };
  }
}
