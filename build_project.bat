@echo off
echo [1/2] Gerando Prisma Client...
call npm run db:generate
echo [2/2] Compilando TypeScript...
call npm run build
echo Build concluído!
pause
