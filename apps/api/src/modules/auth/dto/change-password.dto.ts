import { IsString, MinLength } from 'class-validator';

export class ChangePasswordDto {
  @IsString()
  @MinLength(1, { message: 'current password is required' })
  currentPassword!: string;

  @IsString()
  @MinLength(8, { message: 'new password must be at least 8 characters' })
  newPassword!: string;
}
