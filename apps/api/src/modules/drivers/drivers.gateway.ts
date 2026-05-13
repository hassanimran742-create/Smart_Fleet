import { Logger } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { DriversService } from './drivers.service';
import { PrismaService } from '../../prisma/prisma.service';

@WebSocketGateway({ namespace: '/drivers', cors: true })
export class DriversGateway implements OnGatewayConnection {
  @WebSocketServer() server!: Server;
  private logger = new Logger('DriversGateway');

  constructor(
    private readonly drivers: DriversService,
    private readonly prisma: PrismaService,
  ) {}

  async handleConnection(socket: Socket) {
    // On connect, send current driver locations snapshot to the newly connected client
    const rows: { id: string; name: string; lat: number; lng: number; updated_at: string }[] =
      await this.prisma.$queryRaw`
        SELECT d.id, u.name,
               ST_Y(d.current_location) AS lat,
               ST_X(d.current_location) AS lng,
               d.current_location_updated_at AS updated_at
        FROM drivers d
        JOIN users u ON u.id = d.user_id
        WHERE d.current_location IS NOT NULL AND d.is_online = TRUE
      `;
    socket.emit('drivers:snapshot', rows);
  }

  @SubscribeMessage('location:update')
  async onLocation(
    @ConnectedSocket() socket: Socket,
    @MessageBody() data: { driverId: string; lat: number; lng: number },
  ) {
    await this.drivers.updateLocation(data.driverId, data.lat, data.lng);
    const payload = {
      driverId: data.driverId,
      lat: data.lat,
      lng: data.lng,
      at: new Date().toISOString(),
    };
    this.server.emit('driver:location', payload);
    return { ok: true };
  }

  @SubscribeMessage('online:set')
  async setOnline(@MessageBody() data: { driverId: string; isOnline: boolean }) {
    await this.drivers.setOnline(data.driverId, data.isOnline);
    this.server.emit('driver:online', data);
    return { ok: true };
  }
}
