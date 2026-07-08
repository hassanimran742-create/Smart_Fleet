import { IsString, Matches, MinLength } from 'class-validator';

export class LoginPasswordDto {
  // E.164 phone, same convention as the rest of the system.
  @IsString()
  @Matches(/^\+[1-9]\d{6,14}$/, { message: 'phone must be E.164 (e.g. +923000000000)' })
  phone!: string;

  @IsString()
  @MinLength(8, { message: 'password must be at least 8 characters' })
  password!: string;
}
