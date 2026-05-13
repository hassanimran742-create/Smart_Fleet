import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { PK_CITIES, findCity } from '../../data/pk-locations';

@Injectable()
export class CitiesService {
  constructor(private prisma: PrismaService) {}

  /**
   * Returns the DB-registered cities. If none, falls back to the static
   * PK reference list (so the admin UI is never empty during first-run).
   */
  async list() {
    const rows = await this.prisma.city.findMany({ orderBy: { name: 'asc' } });
    if (rows.length > 0) return rows;
    return PK_CITIES.map((c, i) => ({
      id: `seed-${i}`,
      name: c.name,
      countryCode: c.countryCode,
      _virtual: true,
    }));
  }

  async byId(id: string) {
    const city = await this.prisma.city.findUnique({ where: { id } });
    if (!city) throw new NotFoundException();
    return city;
  }

  async areasForCity(cityIdOrName: string) {
    let cityName = cityIdOrName;
    const city = await this.prisma.city.findUnique({ where: { id: cityIdOrName } });
    if (city) cityName = city.name;

    const ref = findCity(cityName);
    if (!ref) return [];
    return ref.areas;
  }

  async createCity(input: { name: string; countryCode?: string }) {
    return this.prisma.city.create({
      data: { name: input.name, countryCode: input.countryCode ?? 'PK' },
    });
  }
}
