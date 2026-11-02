import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import bcrypt from 'bcryptjs';
import { SuperAdminEntity } from '../../../../super-admins/infrastructure/persistence/relational/entities/super-admin.entity';

@Injectable()
export class SuperAdminSeedService {
  constructor(
    @InjectRepository(SuperAdminEntity)
    private repository: Repository<SuperAdminEntity>,
  ) {}

  async run() {
    const email = process.env.SUPER_ADMIN_EMAIL?.trim().toLowerCase();
    const password = process.env.SUPER_ADMIN_PASSWORD;

    if (!email || !password) {
      console.log(
        'SUPER_ADMIN_EMAIL / SUPER_ADMIN_PASSWORD not set, skipping super admin seed',
      );
      return;
    }

    const exists = await this.repository.findOne({ where: { email } });

    if (!exists) {
      const salt = await bcrypt.genSalt();

      await this.repository.save(
        this.repository.create({
          name: process.env.SUPER_ADMIN_NAME?.trim() || 'Super Admin',
          email,
          passwordHash: await bcrypt.hash(password, salt),
          role: 'super_admin',
          status: 'active',
        }),
      );
    }
  }
}
