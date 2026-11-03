# O Bicho Certo — Automação ABC

Monitoramento prospectivo dos três radares da LOOK Goiás.

## Modelos
- Radar A: Radar 22 original.
- Radar B: Radar 22 sem histórico por horário.
- Radar C: Radar 22 sem chamada ±7.

## Objetivo
Comparar os próximos 100 testes válidos, registrando cinco grupos por radar antes de cada extração.

## Regras de segurança
- Preservar o Radar 22 principal e todos os testes anteriores.
- Não aceitar previsões retroativas.
- Não reescrever escolhas depois de conhecer o resultado.
- Não duplicar extrações.
- Manter histórico persistente e backups.
- Tratar os modelos como experimentais, sem garantia de acerto.

## Implantação
A integração com o coletor LOOK e a execução agendada no Render serão configuradas em arquivos separados.

Status: documentação inicial. Automação ainda não ativada.
