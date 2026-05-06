from sqlalchemy import Column, Integer, String, Float, DateTime, ForeignKey, Boolean
from sqlalchemy.orm import relationship
from sqlalchemy.ext.declarative import declarative_base
import datetime

Base = declarative_base()

class User(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String)
    email = Column(String, unique=True, index=True)
    hashed_password = Column(String)
    current_entity_id = Column(Integer, ForeignKey("entities.id"))

class Entity(Base):
    __tablename__ = "entities"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String)
    logo_url = Column(String, nullable=True)

class Category(Base):
    __tablename__ = "categories"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String)
    type = Column(String) # Revenue, Expense, etc.

class Transaction(Base):
    __tablename__ = "transactions"
    id = Column(Integer, primary_key=True, index=True)
    entity_id = Column(Integer, ForeignKey("entities.id"))
    category_id = Column(Integer, ForeignKey("categories.id"))
    vendor_name = Column(String)
    amount = Column(Float)
    timestamp = Column(DateTime, default=datetime.datetime.utcnow)
    status = Column(String) # cleared, reconciled, missing_receipt
    icon = Column(String, default="💳")
