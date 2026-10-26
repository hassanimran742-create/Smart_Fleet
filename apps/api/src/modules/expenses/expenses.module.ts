import { Module } from '@nestjs/common';
import { ExpenseTypesController } from './expense-types.controller';
import { ExpenseTypesService } from './expense-types.service';
import { ExpensesClock } from './expenses.clock';
import { ExpensesController } from './expenses.controller';
import { ExpensesService } from './expenses.service';

/**
 * Expenses and expense types (API_CONTRACT §5.1, §7.12; ADR-14). It owns `expenses` and
 * `expense_types` and calls only files and audit (both global), plus settings for the time zone.
 * **It never imports WalletModule**: an expense can't touch a distributor's balance or the ledger,
 * and a test fails if anything in this folder imports the wallet.
 */
@Module({
  controllers: [ExpensesController, ExpenseTypesController],
  providers: [ExpensesService, ExpenseTypesService, ExpensesClock],
  exports: [ExpensesService, ExpenseTypesService],
})
export class ExpensesModule {}
