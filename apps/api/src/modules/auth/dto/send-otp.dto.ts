import { IsEnum, IsOptional, IsString, Matches } from 'class-validator';

export class SendOtpDto {
  @IsString()
  @Matches(/^\+923\d{9}$/, { message: 'Phone must be in PK E.164 form (+923XXXXXXXXX)' })
  phone!: string;

  @IsOptional()
  @IsEnum(['LOGIN', 'RESET'])
  purpose: 'LOGIN' | 'RESET' = 'LOGIN';
}
